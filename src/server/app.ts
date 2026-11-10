// Hono API（Bun 本地服务与 Cloudflare Worker 共用）。
// 运行时差异（快照来源、推送、访问统计存储）通过 ApiOptions 注入。
import { Hono, type Context, type Env } from 'hono';
import { cors } from 'hono/cors';
import { buildPlayoffTeamMeta, excludePlayoffTop50, mergeInitialPlayoffTeams, mergePlayoffTeams, sortPlayoffTeams, type PlayoffSort, type PlayoffTeamRow } from '../shared/playoff.ts';
import { filterByProvince } from '../shared/province.ts';
import type { Board, HealthInfo, HitEvent, OnlineInfo, Snapshot, StatsSummary } from '../shared/types.ts';
import { contentDisposition, csvFilename, playoffTeamsToCsv, rowsToCsv } from './csv.ts';
import { fetchAllPlayoffRows, isPlayoffBoardKey, getPlayoffEntry, getPlayoffInfo, getPlayoffLeaderboard } from './playoff.ts';
import { clampDays, parseHit, type HitContext } from './visits.ts';
import { errMsg, getBoard, getConfig, getSnapshot, parseBoardId } from './upstream.ts';
import { handleMcpRequest } from './mcp.ts';
import { defaultMcpDataSource, type McpDataSource } from './mcp-tools.ts';

export interface StatsBackend {
  hit(evt: HitEvent, ctx: HitContext): Promise<void>;
  summary(days: number, online: number): Promise<StatsSummary>;
}

export interface ApiOptions<E extends Env> {
  runtime: HealthInfo['runtime'];
  /** 推送间隔；null = 没有推送通道 */
  pushIntervalMs: number | null;
  /** 覆盖整站快照来源（Worker 优先用推送中枢里的快照） */
  snapshot?: (c: Context<E>, force: boolean) => Promise<{ snap: Snapshot; via: string }>;
  /** 访问统计后端；不配置则 /api/hit 静默丢弃、/api/stats 404 */
  stats?: (c: Context<E>) => { backend: StatsBackend; key: string; ctx: HitContext } | null;
  online?: (c: Context<E>) => Promise<OnlineInfo>;
  /** MCP read-only source override (also useful for deterministic protocol tests). */
  mcpSource?: McpDataSource;
}

export const isForce = (c: Context) => c.req.query('force') === '1' || c.req.query('refresh') === '1';

/** 常量时间比较，避免用响应时间猜 key */
function safeEqual(a: string, b: string) {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function statsKeyOf(c: Context) {
  const auth = c.req.header('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : c.req.query('key') || '';
}

export function createApi<E extends Env = Env>(opts: ApiOptions<E>) {
  const api = new Hono<E>().basePath('/api');

  // GitHub Pages 站点跨域调用 Worker 的 API
  api.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type', 'authorization', 'mcp-protocol-version', 'mcp-session-id', 'mcp-method', 'mcp-name', 'last-event-id'], exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'], maxAge: 86400 }));
  api.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });

  // MCP uses the same upstream caches, but needs atomic cache timestamps and
  // groupId-only enrichment; legacy push snapshots cannot guarantee either.
  api.all('/mcp', (c) => handleMcpRequest(c.req.raw, opts.mcpSource ?? defaultMcpDataSource));

  api.get('/health', (c) =>
    c.json<HealthInfo>({
      ok: true,
      campId: getConfig().campId,
      cacheTtlMs: getConfig().ttlMs,
      at: new Date().toISOString(),
      runtime: opts.runtime,
      push: opts.pushIntervalMs ? { intervalMs: opts.pushIntervalMs } : null,
      stats: Boolean(opts.stats?.(c)),
    }),
  );

  api.get('/snapshot', async (c) => {
    const force = isForce(c);
    const { snap, via } = opts.snapshot ? await opts.snapshot(c, force) : { snap: await getSnapshot({ force }), via: 'upstream' };
    if (!snap.boards[0]?.rows.length && snap.boards.every((b) => !b.rows.length)) {
      return c.json({ error: 'upstream failure', detail: snap.boards.map((b) => b.error).find(Boolean) || 'empty' }, 502);
    }
    c.header('X-Source', via);
    return c.json(snap);
  });

  api.get('/board/:id', async (c) => {
    const id = parseBoardId(c.req.param('id'));
    if (!id) return c.json({ error: 'board must be "total" or "q<questionId>"' }, 400);
    const board = await getBoard(id, { force: isForce(c) });
    return c.json(board);
  });

  // 加赛首屏：入口 + 提测配置 + 题目介绍（600081）
  api.get('/playoff', async (c) => c.json(await getPlayoffInfo({ force: isForce(c) })));

  // 加赛榜：?board=combined|performance|prompt&pageNo=1&pageSize=100[&questionId=600081]
  api.get('/playoff/leaderboard', async (c) => {
    const board = c.req.query('board') || 'combined';
    if (!isPlayoffBoardKey(board)) return c.json({ error: 'board must be "combined", "performance" or "prompt"' }, 400);
    let questionId = c.req.query('questionId');
    if (!questionId) {
      const entry = await getPlayoffEntry().catch(() => null);
      if (!entry) return c.json({ error: 'playoff entry unavailable' }, 502);
      questionId = String(entry.value.questionId);
    }
    const pageNo = Math.max(1, Math.min(10_000, Math.floor(Number(c.req.query('pageNo')) || 1)));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(c.req.query('pageSize')) || 100)));
    return c.json(await getPlayoffLeaderboard(questionId, board, { force: isForce(c), pageNo, pageSize }));
  });

  // 加赛合并 CSV：?sort=combined|performance|prompt&province=...
  // 一支队伍一行，含两个子题全部字段；服务端拉完所有分页，不是只导当前已加载的 100 行。
  api.get('/playoff/export.csv', async (c) => {
    const raw = c.req.query('sort') || c.req.query('board') || 'combined';
    if (!isPlayoffBoardKey(raw)) return c.json({ error: 'sort must be "combined", "performance" or "prompt"' }, 400);
    const sort: PlayoffSort = raw;
    let questionId = c.req.query('questionId');
    if (!questionId) {
      const entry = await getPlayoffEntry().catch(() => null);
      if (!entry) return c.json({ error: 'playoff entry unavailable' }, 502);
      questionId = String(entry.value.questionId);
    }
    try {
      const [combined, performance, prompt, initial] = await Promise.all([
        fetchAllPlayoffRows(questionId, 'combined', { force: isForce(c) }),
        fetchAllPlayoffRows(questionId, 'performance', { force: isForce(c) }),
        fetchAllPlayoffRows(questionId, 'prompt', { force: isForce(c) }),
        getSnapshot({ force: isForce(c) }).catch(() => null),
      ]);
      const meta = buildPlayoffTeamMeta(initial?.boards ?? []);
      // 初赛前 50 名直接晋级决赛，不参加加赛；合并榜和导出同样剔除。
      const mergedAll: PlayoffTeamRow[] = mergePlayoffTeams({ combined, performance, prompt }, meta);
      // 初赛 51 名起都进入总榜；未提测的队伍先保留初赛分。
      const withInitial = mergeInitialPlayoffTeams(mergedAll, initial?.boards);
      const merged = excludePlayoffTop50(withInitial, initial?.boards);
      const province = c.req.query('province') || '';
      const rows = sortPlayoffTeams(filterByProvince(merged, province), sort);
      const titles: Record<PlayoffSort, string> = {
        combined: '加赛总榜',
        performance: '性能榜',
        prompt: 'Agent Prompt 榜',
      };
      const board: Board = {
        id: `playoff-${sort}`,
        title: titles[sort],
        kind: 'total',
        questionId: Number(questionId),
        rows: [],
        error: null,
        stale: false,
        reportedTotal: combined.total,
        source: 'https://open.oceanbase.com/competition/playoff',
      };
      return c.body(playoffTeamsToCsv(rows), 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': contentDisposition(csvFilename(board, province)),
      });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 502);
    }
  });

  // ?board=total|q600071  &province=四川省|__none__
  api.get('/export.csv', async (c) => {
    const id = parseBoardId(c.req.query('board') || 'total');
    if (!id) return c.json({ error: 'board must be "total" or "q<questionId>"' }, 400);
    const board = await getBoard(id, { force: isForce(c) });
    if (!board) return c.json({ error: 'not found' }, 404);
    const province = c.req.query('province') || '';
    const rows = filterByProvince(board.rows, province);
    return c.body(rowsToCsv(rows), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(csvFilename(board, province)),
    });
  });

  api.get('/online', async (c) => {
    if (!opts.online) return c.json<OnlineInfo>({ sockets: 0, lastPush: null, intervalMs: opts.pushIntervalMs ?? 0 });
    return c.json(await opts.online(c));
  });

  // 前端 sendBeacon 打点（text/plain 避免预检）；统计没配置时静默成功，前端不用区分
  api.post('/hit', async (c) => {
    const s = opts.stats?.(c);
    if (!s) return c.body(null, 204);
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return c.json({ ok: false }, 400);
    }
    const evt = parseHit(body);
    if (!evt) return c.json({ ok: false }, 400);
    await s.backend.hit(evt, s.ctx);
    return c.body(null, 204);
  });

  // 统计数据：Authorization: Bearer <STATS_KEY>（或 ?key=）；key 不对一律 404，不暴露接口存在
  api.get('/stats', async (c) => {
    const s = opts.stats?.(c);
    if (!s || !safeEqual(statsKeyOf(c), s.key)) return c.json({ error: 'not found' }, 404);
    const online = opts.online ? (await opts.online(c).catch(() => null))?.sockets ?? 0 : 0;
    return c.json(await s.backend.summary(clampDays(c.req.query('days')), online));
  });

  api.notFound((c) => c.json({ error: 'unknown endpoint' }, 404));
  api.onError((err, c) => {
    console.error('[api]', c.req.path, err);
    return c.json({ error: 'upstream failure', detail: errMsg(err) }, 502);
  });

  return api;
}
