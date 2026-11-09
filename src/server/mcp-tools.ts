import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { cutoffs, localRanks, nextTier, searchRows } from '../shared/insights.ts';
import { buildPlayoffTeamMeta, playoffRowToTimingRow } from '../shared/playoff.ts';
import { predict } from '../shared/predict.ts';
import { promotionModel } from '../shared/promotion.ts';
import { filterByProvince } from '../shared/province.ts';
import { agg, buildTimingModel } from '../shared/timing.ts';
import type { Board, PlayoffBoardKey, PlayoffEntry, PlayoffLeaderboard, PlayoffRow, Row, Snapshot } from '../shared/types.ts';
import { getPlayoffEntry, getPlayoffLeaderboard } from './playoff.ts';
import { getSnapshot, type Cached } from './upstream.ts';

/** Read caches only: no force refresh, submission, credentials or private participation API. */
export interface McpDataSource {
  getSnapshot(): Promise<Snapshot>;
  getPlayoffEntry(): Promise<Cached<PlayoffEntry>>;
  getPlayoffLeaderboard(questionId: number, board: PlayoffBoardKey): Promise<PlayoffLeaderboard>;
  /** Actual successful-cache time, never the time a snapshot wrapper was generated. Unknown => null. */
  getBoardFetchedAt?(boardId: string): Promise<number | null>;
  now?(): number;
}

export const defaultMcpDataSource: McpDataSource = {
  getSnapshot: () => getSnapshot({ groupIdOnly: true }),
  getPlayoffEntry: () => getPlayoffEntry(),
  getPlayoffLeaderboard: (questionId, board) => getPlayoffLeaderboard(questionId, board),
  now: () => Date.now(),
};

const STALE_MS = 120_000;
const MAX_BOARDS = 15; // initial total + 11 tracks + 3 playoff boards; bounded team responses
const PLAYOFF_KEYS: PlayoffBoardKey[] = ['combined', 'performance', 'prompt'];
const PLAYOFF_TITLES = { combined: '加赛综合榜', performance: '加赛性能榜', prompt: '加赛 Prompt 榜' };
const boardIdSchema = z.string().max(40).regex(/^(total|q[1-9]\d{0,11}|playoff-(combined|performance|prompt))$/).describe('榜单 ID；先调用 oceanbase_list_boards 发现，例如 total、q600071、playoff-combined');
const groupIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe('公开队伍 groupId（跨榜唯一关联键）');
const provinceSchema = z.string().trim().min(1).max(100).describe('省份全称精确匹配，例如 四川省；__none__ 表示未填省份，只对已有公开资料筛选');
const outputSchema = z.object({ ok: z.boolean(), status: z.string() }).passthrough();
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

type Payload = Record<string, unknown> & { ok: boolean; status: string };
interface Meta {
  fetchedAt: string | null;
  generatedAt?: string;
  stale: boolean;
  ageSeconds: number | null;
  staleAfterSeconds: number;
  warnings: string[];
}
interface LoadedBoard {
  board: { boardId: string; title: string; kind: string; source: string; scoreMetric: string; questionId: number | null; supportsPrediction: boolean; predictionBoardId: string | null; provisional?: boolean };
  rows: Row[];
  extras?: Map<Row, PlayoffRow>;
  meta: Meta;
  reportedTotal: number | null;
  failed: boolean;
  snapshot?: Snapshot;
}

const safeIso = (at: number | null | undefined): string | null =>
  at != null && Number.isFinite(at) && at > 0 && Math.abs(at) < 8.64e15 ? new Date(at).toISOString() : null;

function metadata(at: number | null | undefined, stale: boolean, error: boolean, now: number, generatedAt?: string): Meta {
  const fetchedAt = safeIso(at);
  const ageSeconds = fetchedAt ? Math.max(0, (now - at!) / 1000) : null;
  const warnings: string[] = [];
  if (stale || error) warnings.push('上游获取异常，返回最后一次成功缓存。');
  if (!fetchedAt) warnings.push('榜单缓存时间未知。');
  if (ageSeconds != null && ageSeconds > STALE_MS / 1000) warnings.push('缓存已超过 120 秒。');
  if (at != null && at > now) warnings.push('缓存时间晚于当前时间。');
  return { fetchedAt, ...(generatedAt ? { generatedAt } : {}), stale: stale || error || !fetchedAt || ageSeconds! > STALE_MS / 1000 || at! > now, ageSeconds, staleAfterSeconds: STALE_MS / 1000, warnings };
}

function reply(payload: Payload): CallToolResult {
  return { structuredContent: payload, content: [{ type: 'text', text: JSON.stringify(payload) }], ...(!payload.ok ? { isError: true } : {}) };
}
async function safely(action: () => Promise<Payload>, now: () => number): Promise<CallToolResult> {
  try { return reply({ ...await action(), checkedAt: safeIso(now()) }); }
  catch { return reply({ ok: false, status: 'upstream_error', checkedAt: safeIso(now()), message: '公开榜单数据暂不可用' }); }
}
const missing = (boardId: string): Payload => ({ ok: false, status: 'not_found', boardId, message: '当前公开数据中没有该榜单，请先调用 oceanbase_list_boards。' });
const unavailable = (b: LoadedBoard): Payload => ({ ok: false, status: 'upstream_error', board: b.board, meta: b.meta, message: '上游未返回可用数据' });
const preliminary = (snap: Snapshot): Board[] => snap.boards.filter((b) => b.id === 'total' || (/^q[1-9]\d{0,11}$/.test(b.id) && b.questionId !== 600081)).slice(0, MAX_BOARDS - PLAYOFF_KEYS.length);

async function warnMetadataDependencies(meta: Meta, source: McpDataSource, boards: Board[]): Promise<void> {
  const dependencies = await Promise.all(boards.map(async (b) => {
    const at = b.fetchedAt ?? await source.getBoardFetchedAt?.(b.id).catch(() => null);
    return { boardId: b.id, meta: metadata(at, b.stale, Boolean(b.error), source.now?.() ?? Date.now()) };
  }));
  const old = dependencies.filter((b) => b.meta.stale);
  if (old.length) meta.warnings.push(`学校和省份补充资料缓存过期或时间未知：${old.map((b) => `${b.boardId}=${b.meta.fetchedAt ?? 'unknown'}`).join('，')}。`);
}

async function loadBoard(source: McpDataSource, boardId: string, now: number, existingSnapshot?: Snapshot, requestedQuestionId?: number): Promise<LoadedBoard | null> {
  if (!boardId.startsWith('playoff-')) {
    const snapshot = existingSnapshot ?? await source.getSnapshot();
    const b = preliminary(snapshot).find((b) => b.id === boardId);
    if (!b) return null;
    const at = b.fetchedAt ?? await source.getBoardFetchedAt?.(boardId).catch(() => null);
    const meta = metadata(at, b.stale, Boolean(b.error), source.now?.() ?? Date.now(), snapshot.generatedAt);
    if (b.kind === 'track') {
      await warnMetadataDependencies(meta, source, preliminary(snapshot).filter((x) => x.kind === 'total'));
    }
    return {
      board: { boardId: b.id, title: b.title, kind: b.kind, source: b.source, scoreMetric: 'score', questionId: b.kind === 'track' ? b.questionId ?? Number(b.id.slice(1)) : null, supportsPrediction: b.kind === 'track', predictionBoardId: b.kind === 'track' ? b.id : null },
      rows: b.rows, meta,
      reportedTotal: b.reportedTotal, failed: Boolean(b.error) && !b.rows.length, snapshot,
    };
  }
  const key = boardId.slice('playoff-'.length) as PlayoffBoardKey;
  const entry = await source.getPlayoffEntry();
  if (!(entry.value.questionId > 0)) throw new Error('unavailable playoff entry');
  if (requestedQuestionId != null && entry.value.questionId !== requestedQuestionId) return null;
  const data = await source.getPlayoffLeaderboard(entry.value.questionId, key);
  const snap = existingSnapshot ?? await source.getSnapshot().catch(() => null);
  const teamMeta = buildPlayoffTeamMeta(snap ? preliminary(snap) : []);
  const rows = data.rows.map((r, i) => playoffRowToTimingRow(r, key, i, r.groupId == null ? null : teamMeta.get(r.groupId)));
  const meta = metadata(data.at, data.stale || entry.stale, Boolean(data.error || entry.error), source.now?.() ?? Date.now());
  if (!snap) meta.warnings.push('初赛资料不可用，加赛学校和省份资料未补齐。');
  if (snap) await warnMetadataDependencies(meta, source, preliminary(snap));
  if (data.total > rows.length) meta.warnings.push(`当前返回 ${rows.length} 行，上游总数 ${data.total}；分页与筛选基于返回行。`);
  return {
    board: { boardId, title: PLAYOFF_TITLES[key], kind: 'playoff', source: 'https://open.oceanbase.com/competition/armory', scoreMetric: key === 'combined' ? 'totalScore' : key === 'performance' ? 'performance' : 'promptRawScore', questionId: entry.value.questionId, supportsPrediction: true, predictionBoardId: `q${entry.value.questionId}`, provisional: data.provisional },
    rows, extras: new Map(rows.map((r, i) => [r, data.rows[i]])), meta,
    reportedTotal: data.total, failed: Boolean(data.error) && !rows.length,
  };
}

/** Explicit allowlist: internal userId, recordId, advisor and raw upstream errors never escape. */
function publicRow(r: Row, localRank?: number, extra?: PlayoffRow): Record<string, unknown> {
  return {
    groupId: r.groupId, name: r.name, school: r.school, province: r.province,
    rank: r.rank, ...(localRank != null ? { localRank } : {}), score: r.score,
    bestSubmit: r.bestSubmit, updated: r.updated,
    ...(extra ? { performance: extra.performance, performancePoints: extra.performancePoints, performanceRank: extra.performanceRank,
      promptRawScore: extra.promptRawScore, promptPoints: extra.promptPoints, promptRank: extra.promptRank,
      combinedRank: extra.combinedRank, playoffScore: extra.playoffScore, preliminaryScore: extra.preliminaryScore, totalScore: extra.totalScore } : {}),
  };
}
function coverage(b: LoadedBoard) {
  return { availableRows: b.rows.length, reportedTotal: b.reportedTotal, truncated: b.reportedTotal != null && b.reportedTotal > b.rows.length, scope: 'available_rows' };
}
function scopedRows(b: LoadedBoard, province?: string, query?: string): Row[] {
  // Search only public fields. Keep original references so playoff extras still match their rows.
  return filterByProvince(b.rows, province).filter((r) => searchRows([{ ...r, advisor: '' }], query).length > 0);
}
function bestGroupRow(rows: Row[], groupId: number): Row | undefined {
  return rows.filter((r) => r.groupId === groupId).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.rank - b.rank)[0];
}

/** Five bounded, public, read-only tools. Each result includes both JSON text and structuredContent. */
export function registerBoardTools(server: McpServer, source: McpDataSource = defaultMcpDataSource): void {
  const now = () => source.now?.() ?? Date.now();
  const run = (action: () => Promise<Payload>) => safely(action, now);
  server.registerTool('oceanbase_list_boards', {
    title: '发现 OceanBase 榜单', description: '列出初赛总榜、11 个赛道与加赛三榜的 ID、分数口径、时间与可用性；predictionBoardId 指向各赛题的出分预测入口。',
    inputSchema: z.object({}).strict(), outputSchema, annotations,
  }, () => run(async () => {
    const at = now();
    const [snapResult, entryResult] = await Promise.allSettled([source.getSnapshot(), source.getPlayoffEntry()]);
    const snap = snapResult.status === 'fulfilled' ? snapResult.value : null;
    const ids = [...(snap ? preliminary(snap).map((b) => b.id) : []), ...PLAYOFF_KEYS.map((k) => `playoff-${k}`)];
    const boards = await Promise.all(ids.map(async (boardId) => {
      try {
        // Keep discovery useful even when another upstream family is down.
        if (boardId.startsWith('playoff-') && entryResult.status === 'rejected') throw new Error('entry unavailable');
        const loaded = await loadBoard(source, boardId, at, snap ?? undefined);
        return loaded ? { ...loaded.board, status: loaded.failed ? 'upstream_error' : loaded.rows.length ? 'ok' : 'empty', meta: loaded.meta, coverage: coverage(loaded) } : null;
      } catch {
        return { boardId, title: PLAYOFF_TITLES[boardId.slice(8) as PlayoffBoardKey] ?? boardId, status: 'upstream_error', supportsPrediction: boardId !== 'total', predictionBoardId: boardId.startsWith('playoff-') ? entryResult.status === 'fulfilled' && entryResult.value.value.questionId > 0 ? `q${entryResult.value.value.questionId}` : null : boardId === 'total' ? null : boardId, meta: metadata(null, true, true, at) };
      }
    }));
    return { ok: true, status: snapResult.status === 'rejected' || boards.some((b) => b?.status === 'upstream_error') ? 'partial' : 'ok', boards: boards.filter(Boolean), warnings: snap ? [] : ['初赛榜单发现失败'], readOnly: true, authentication: 'none' };
  }));

  server.registerTool('oceanbase_query_leaderboard', {
    title: '筛选分页查询榜单', description: '按队伍、学校关键词和省份过滤榜单后分页。limit 默认20最大100；total为筛选后的行数，coverage列明已返回行数与上游总数。rank为榜单名次，localRank为筛选组内同分并列名次。',
    inputSchema: z.object({ boardId: boardIdSchema, query: z.string().trim().max(200).optional().describe('队名/学校/省份等关键词，空格分词且须同时命中'), province: provinceSchema.optional(), offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(20) }).strict(), outputSchema, annotations,
  }, (args) => run(async () => {
    const b = await loadBoard(source, args.boardId, now());
    if (!b) return missing(args.boardId);
    if (b.failed) return unavailable(b);
    const rows = scopedRows(b, args.province, args.query);
    const ranks = localRanks(rows);
    const page = rows.slice(args.offset, args.offset + args.limit);
    const hasMore = args.offset + page.length < rows.length;
    return { ok: true, status: rows.length ? 'ok' : 'empty', board: b.board, meta: b.meta, coverage: coverage(b),
      total: rows.length, offset: args.offset, limit: args.limit, hasMore, nextOffset: hasMore ? args.offset + page.length : null,
      rows: page.map((r) => publicRow(r, ranks.get(r), b.extras?.get(r))) };
  }));

  server.registerTool('oceanbase_get_team', {
    title: '队伍跨榜详情', description: '按 groupId 精确关联初赛与加赛，最多返回15个榜、每榜一条最好成绩；同时列出已查询榜单及数据时间。',
    inputSchema: z.object({ groupId: groupIdSchema }).strict(), outputSchema, annotations,
  }, ({ groupId }) => run(async () => {
    const at = now();
    const snap = await source.getSnapshot().catch(() => null);
    const ids = [...(snap ? preliminary(snap).map((b) => b.id) : []), ...PLAYOFF_KEYS.map((k) => `playoff-${k}`)].slice(0, MAX_BOARDS);
    const entries: Record<string, unknown>[] = [];
    const unavailableBoards: string[] = snap ? [] : ['preliminary'];
    const examinedBoards: { boardId: string; meta: Meta }[] = [];
    await Promise.all(ids.map(async (id) => {
      try {
        const b = await loadBoard(source, id, at, snap ?? undefined);
        if (b) examinedBoards.push({ boardId: id, meta: b.meta });
        if (!b || b.failed) { unavailableBoards.push(id); return; }
        const r = bestGroupRow(b.rows, groupId);
        if (r) entries.push({ boardId: id, board: b.board, meta: b.meta, row: publicRow(r, undefined, b.extras?.get(r)), coverage: coverage(b) });
      } catch { unavailableBoards.push(id); }
    }));
    entries.sort((a, b) => ids.indexOf(String(a.boardId)) - ids.indexOf(String(b.boardId)));
    examinedBoards.sort((a, b) => ids.indexOf(a.boardId) - ids.indexOf(b.boardId));
    const times = examinedBoards.map((b) => b.meta.fetchedAt ? Date.parse(b.meta.fetchedAt) : null);
    const incomplete = unavailableBoards.length > 0 || examinedBoards.some((b) => b.meta.stale);
    const meta = metadata(times.length && times.every((t) => t != null) && !unavailableBoards.length ? Math.min(...times as number[]) : null, incomplete, unavailableBoards.length > 0, now());
    meta.warnings = [...new Set([...meta.warnings, ...examinedBoards.flatMap((b) => b.meta.warnings)])];
    return { ok: entries.length > 0 || unavailableBoards.length === 0, status: unavailableBoards.length && !entries.length ? 'upstream_error' : incomplete ? 'partial' : entries.length ? 'ok' : 'not_found', groupId, entries, meta, examinedBoards, unavailableBoards, maxBoards: MAX_BOARDS };
  }));

  server.registerTool('oceanbase_analyze_cutoff', {
    title: '分析分数线与晋级差距', description: '计算分数线、同分名次和队伍差距。rank默认初赛100、加赛50；province指定时分析省内队伍并重算名次。groupId可选，返回该队差距；人数或有效分数不足时分数线为null。',
    inputSchema: z.object({ boardId: boardIdSchema, rank: z.number().int().min(1).max(100000).optional(), groupId: groupIdSchema.optional(), province: provinceSchema.optional() }).strict(), outputSchema, annotations,
  }, (args) => run(async () => {
    const b = await loadBoard(source, args.boardId, now());
    if (!b) return missing(args.boardId);
    if (b.failed) return unavailable(b);
    const rows = scopedRows(b, args.province);
    const ranks = localRanks(rows);
    const ranked = args.province ? rows.map((r) => ({ ...r, rank: ranks.get(r)! })) : rows;
    const targetRank = args.rank ?? (b.board.kind === 'playoff' ? 50 : 100);
    const cutoffScore = cutoffs(ranked, [targetRank])[0].score;
    const target = args.groupId == null ? undefined : bestGroupRow(ranked, args.groupId);
    const gap = cutoffScore == null || target?.score == null ? null : Math.max(0, Math.round((cutoffScore - target.score) * 1e6) / 1e6);
    let promotion: Record<string, unknown> | null = null;
    if (b.snapshot && b.board.kind === 'total' && !args.province) {
      // The shared model has a userId fallback; null it here to enforce MCP's groupId-only contract.
      const clean: Snapshot = { ...b.snapshot, boards: preliminary(b.snapshot).map((board) => ({ ...board, rows: board.rows.map((r) => ({ ...r, userId: null })) })) };
      const model = promotionModel(clean);
      const dependencies = await Promise.all(clean.boards.map(async (x) => {
        const fetchedAt = x.fetchedAt ?? await source.getBoardFetchedAt?.(x.id).catch(() => null);
        return { boardId: x.id, meta: metadata(fetchedAt, x.stale, Boolean(x.error), now(), clean.generatedAt) };
      }));
      const staleBoards = dependencies.filter((x) => x.meta.stale).map((x) => x.boardId);
      const incomplete = staleBoards.length > 0 || b.meta.stale;
      if (model) promotion = model.missing.length || incomplete
        ? { status: 'insufficient', missingTracks: model.missing, staleBoards, dependencies, message: '赛道数据缺失或过期' }
        : { status: 'ok', fullTotal: model.fullTotal, topTotal: model.topTotal, fullCount: model.fullCount, remainingPlaces: Math.max(0, targetRank - model.fullCount), oneShort: model.oneShort, mismatch: model.mismatch, basis: '各赛道当前最高分之和' };
    }
    return { ok: true, status: rows.length ? 'ok' : 'empty', board: b.board, meta: b.meta, coverage: coverage(b), scope: args.province ? 'province' : 'board', province: args.province ?? null,
      targetRank, cutoffScore, availableTeams: rows.length, team: target ? publicRow(target) : null, teamStatus: args.groupId == null ? 'not_requested' : target ? 'found' : 'not_found', gap,
      nextTier: target ? nextTier(target, ranked) : null, promotion, cutoffBasis: '按名次排序后第 rank 行的分数' };
  }));

  server.registerTool('oceanbase_predict_score_time', {
    title: '赛题耗时与出分预测', description: '按赛题 ID（初赛 q…、加赛 q600081）和提交时刻计算耗时统计与 ETA。加赛三榜共用 q600081 的样本；总榜没有提交维度。至少需要3条有效出分样本和120秒内的榜单缓存。submittedAt 使用带Z或时区偏移的ISO时间。',
    inputSchema: z.object({ boardId: boardIdSchema, submittedAt: z.iso.datetime({ offset: true }).describe('提交时刻，必须明确时区，例如 2026-11-09T12:00:00+08:00') }).strict(), outputSchema, annotations,
  }, ({ boardId, submittedAt }) => run(async () => {
    if (boardId === 'total') return { ok: true, status: 'unsupported', supported: false, boardId, predictionBoardId: null, prediction: null, reason: '总榜没有提交维度' };
    const alias = boardId.startsWith('playoff-');
    const requestedQuestionId = alias ? undefined : Number(boardId.slice(1));
    let b = alias || boardId === 'q600081'
      ? await loadBoard(source, 'playoff-combined', now(), undefined, requestedQuestionId)
      : await loadBoard(source, boardId, now());
    // Discovery can expose a later playoff question ID; all playoff aliases share its combined source.
    if (!b && !alias && boardId !== 'q600081') b = await loadBoard(source, 'playoff-combined', now(), undefined, requestedQuestionId).catch(() => null);
    const at = now();
    if (!b) return missing(boardId);
    if (b.failed) return unavailable(b);
    const base = { supported: true, boardId, questionId: b.board.questionId, predictionBoardId: b.board.predictionBoardId, board: b.board, meta: b.meta, coverage: coverage(b), submittedAt };
    const refuse = (reason: string, timing?: Record<string, unknown>): Payload => ({ ok: true, status: 'refused', ...base, prediction: null, reason, ...(timing ? { timing } : {}) });
    if (Date.parse(submittedAt) > at) return refuse('提交时刻晚于当前时间');
    if (b.meta.stale) return refuse('榜单缓存过期或时间未知');
    const history = b.rows.filter((r) => r.updated && r.bestSubmit && Date.parse(r.updated) <= at && Date.parse(r.bestSubmit) <= at);
    const tm = buildTimingModel(history, { now: at });
    const secs = tm.recent.pts.map((p) => p.sec);
    const timing = { samples: tm.cleanup.rawN, keptSamples: tm.cleanup.keptN, medianTurnaroundSec: secs.length ? agg(secs, 'median') : null, p90TurnaroundSec: secs.length ? agg(secs, 'p90') : null, estimatedJudgeSec: tm.insufficient ? null : tm.judge.sec, lastDoneAt: safeIso(tm.latest?.done), idleSeconds: tm.idleSec, historicalWindowStale: tm.recent.stale };
    if (tm.insufficient || tm.cleanup.keptN < 3) return { ok: true, status: 'insufficient_data', ...base, prediction: null, reason: tm.cleanup.rawN === 0 ? '暂无出分样本' : '出分样本不足3条', timing };
    if (tm.stalled || tm.recent.stale) return refuse('近期出分样本已过期', timing);
    const p = predict(history, Date.parse(submittedAt), at);
    if (p.kind === 'none' || p.kind === 'stalled' || p.etaMs == null) return refuse('当前模型无 ETA', timing);
    return { ok: true, status: 'ok', ...base, timing,
      prediction: { modelKind: p.kind, etaMs: p.etaMs, lowMs: p.lowMs, highMs: p.highMs, confidence: p.confidence, samples: p.samples, medTurnaroundSec: p.medTurnaroundSec, p90TurnaroundSec: p.p90TurnaroundSec, accuracy: p.accuracy },
    };
  }));
}
