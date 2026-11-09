import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { registerBoardTools, type McpDataSource } from '../src/server/mcp-tools.ts';
import type { Board, PlayoffLeaderboard, PlayoffRow, Row, Snapshot } from '../src/shared/types.ts';

const NOW = Date.parse('2026-11-09T04:20:00Z');
const iso = (t: number) => new Date(t).toISOString();
const row = (p: Partial<Row> = {}): Row => ({ rank: 1, name: '队一', school: '北京大学', province: '北京市', advisor: '老师', score: 100, rawScore: 100000, bestSubmit: iso(NOW - 120000), updated: iso(NOW - 60000), groupId: 1, userId: 'private-user', recordId: 99, ...p });
const board = (p: Partial<Board> = {}): Board => ({ id: 'total', title: '总榜', kind: 'total', questionId: null, rows: [row()], error: null, stale: false, reportedTotal: 1, source: 'https://open.oceanbase.com/competition/armory', ...p });
const playoffRow = (p: Partial<PlayoffRow> = {}): PlayoffRow => ({ groupId: 1, groupName: '队一', performance: 20, performancePoints: 50, performanceRank: 1, promptRawScore: 80, promptPoints: 40, promptRank: 1, combinedRank: 1, playoffScore: 90, preliminaryScore: 100, totalScore: 190, submittedAt: NOW - 60000, ...p });
const playoff = (key: 'combined' | 'performance' | 'prompt', p: Partial<PlayoffLeaderboard> = {}): PlayoffLeaderboard => ({ board: key, provisional: true, activityCode: null, resultSequence: 1, total: 1, pageNo: 1, pageSize: 100, rows: [playoffRow()], performanceTop: [], promptTop: [], error: null, stale: false, at: NOW - 1000, ...p });
const samples = () => Array.from({ length: 12 }, (_, i) => row({ groupId: i + 1, rank: i + 1, bestSubmit: iso(NOW - (14 - i) * 60000), updated: iso(NOW - (13 - i) * 60000) }));
function source(boards = [board(), board({ id: 'q600071', title: '赛道', kind: 'track', questionId: 600071, rows: samples() })], overrides: Partial<McpDataSource> = {}): McpDataSource {
  return {
    getSnapshot: async (): Promise<Snapshot> => ({ campId: 21, generatedAt: iso(NOW), boards }),
    getBoardFetchedAt: async () => NOW - 1000,
    getPlayoffEntry: async () => ({ value: { campId: 21, questionId: 600081, questionName: '加赛', startsAt: NOW - 1200000, endsAt: NOW + 3600000, phase: 'ONGOING' }, stale: false, error: null, at: NOW - 1000 }),
    getPlayoffLeaderboard: async (_qid, key) => playoff(key), now: () => NOW, ...overrides,
  };
}
const clients: Client[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((c) => c.close())); });
async function connect(s = source()) {
  const server = new McpServer({ name: 'test-board', version: '1.0.0' });
  registerBoardTools(server, s);
  const client = new Client({ name: 'board-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: `oceanbase_${name}`, arguments: args });
  expect(result.structuredContent).toBeDefined();
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  return result.structuredContent as Record<string, any>;
}

describe('public read-only MCP tools', () => {
  test('discovers all preliminary and three playoff boards with strict schemas and annotations', async () => {
    const client = await connect(source([board(), ...Array.from({ length: 11 }, (_, i) => board({ id: `q${600100 + i}`, kind: 'track', questionId: 600100 + i }))]));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    const out = await call(client, 'list_boards');
    expect(out.boards).toHaveLength(15);
    expect(out.boards.map((b: any) => b.boardId)).toContain('playoff-prompt');
    for (const id of ['playoff-combined', 'playoff-performance', 'playoff-prompt']) {
      expect(out.boards.find((b: any) => b.boardId === id)).toMatchObject({ supportsPrediction: true, predictionBoardId: 'q600081' });
    }
    expect(out.boards.find((b: any) => b.boardId === 'total')).toMatchObject({ supportsPrediction: false, predictionBoardId: null });
    expect(out.boards.find((b: any) => b.boardId === 'q600100')).toMatchObject({ supportsPrediction: true, predictionBoardId: 'q600100' });
  });

  test('filters by school words and province before pagination without private identifiers', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ rank: i + 1, groupId: i + 1 }));
    const client = await connect(source([board({ rows, reportedTotal: 30 })]));
    const out = await call(client, 'query_leaderboard', { boardId: 'total', query: '北京 大学', province: '北京市', offset: 20, limit: 5 });
    expect(out).toMatchObject({ ok: true, total: 30, offset: 20, limit: 5, hasMore: true, nextOffset: 25 });
    expect(out.rows).toHaveLength(5);
    expect(out.rows[0]).toMatchObject({ groupId: 21, rank: 21, localRank: 1 });
    expect(JSON.stringify(out)).not.toContain('private-user');
    expect(out.rows[0]).not.toHaveProperty('recordId');
    const defaults = await call(client, 'query_leaderboard', { boardId: 'total' });
    expect(defaults.rows).toHaveLength(20);
    expect((await call(client, 'query_leaderboard', { boardId: 'total', query: '不存在' })).status).toBe('empty');
  });

  test('does not allow advisor-only searches to infer hidden metadata and preserves playoff extras', async () => {
    const client = await connect(source([board({ rows: [row({ advisor: 'UniqueAdvisorSecret' })] })]));
    expect((await call(client, 'query_leaderboard', { boardId: 'total', query: 'UniqueAdvisorSecret' })).total).toBe(0);
    expect((await call(client, 'query_leaderboard', { boardId: 'total', query: '北京大学 UniqueAdvisorSecret' })).total).toBe(0);
    const out = await call(client, 'query_leaderboard', { boardId: 'playoff-performance', query: '北京大学' });
    expect(out.rows[0]).toMatchObject({ groupId: 1, performancePoints: 50 });
  });

  test('shares the __none__ province sentinel for pagination and cutoff analysis', async () => {
    const client = await connect(source([board({ rows: [row(), row({ groupId: 2, rank: 2, score: 80, province: '' }), row({ groupId: 3, rank: 3, score: 50, province: '' })] })]));
    const page = await call(client, 'query_leaderboard', { boardId: 'total', province: '__none__', limit: 1 });
    expect(page).toMatchObject({ total: 2, hasMore: true });
    expect(page.rows[0]).toMatchObject({ groupId: 2, province: '', localRank: 1 });
    const cutoff = await call(client, 'analyze_cutoff', { boardId: 'total', province: '__none__', rank: 1, groupId: 3 });
    expect(cutoff).toMatchObject({ availableTeams: 2, cutoffScore: 80, gap: 30, scope: 'province' });
  });

  test('rejects force, unknown fields, oversized pages and malformed identifiers', async () => {
    const client = await connect();
    for (const args of [{ boardId: 'total', force: true }, { boardId: 'total', limit: 101 }, { boardId: 'total', offset: -1 }, { boardId: '../secret' }]) {
      const out = await client.callTool({ name: 'oceanbase_query_leaderboard', arguments: args });
      expect(out.isError).toBe(true);
    }
    expect((await client.callTool({ name: 'oceanbase_list_boards', arguments: { force: true } })).isError).toBe(true);
  });

  test('enriches playoff schools only by groupId and preserves provisional score meaning', async () => {
    const client = await connect();
    const out = await call(client, 'query_leaderboard', { boardId: 'playoff-performance', query: '北京大学', province: '北京市' });
    expect(out.board).toMatchObject({ provisional: true, scoreMetric: 'performance' });
    expect(out.rows[0]).toMatchObject({ groupId: 1, score: 20, school: '北京大学', performancePoints: 50 });
    expect(out.meta).toMatchObject({ stale: false, fetchedAt: iso(NOW - 1000) });
  });

  test('playoff metadata enrichment warns with real old cache time even when wrapper and score data are fresh', async () => {
    const client = await connect(source(undefined, { getBoardFetchedAt: async () => NOW - 120001 }));
    const out = await call(client, 'query_leaderboard', { boardId: 'playoff-combined', province: '北京市' });
    expect(out.meta).toMatchObject({ stale: false, fetchedAt: iso(NOW - 1000) });
    expect(out.meta.warnings.join('')).toContain(iso(NOW - 120001));
    expect(out.meta.warnings.join('')).toContain('学校和省份');
  });

  test('team joins never match names or userId and returns one result per bounded board', async () => {
    const client = await connect(source([board(), board({ id: 'q600071', kind: 'track', rows: [row({ groupId: 2 })] }), board({ id: 'q600072', kind: 'track', rows: [row({ groupId: 1, score: 80 }), row({ groupId: 1, score: 90 })] })]));
    const out = await call(client, 'get_team', { groupId: 1 });
    expect(out.entries.map((x: any) => x.boardId)).not.toContain('q600071');
    expect(out.entries.filter((x: any) => x.boardId === 'q600072')).toHaveLength(1);
    expect(out.entries.find((x: any) => x.boardId === 'q600072').row.score).toBe(90);
    expect(out.entries.length).toBeLessThanOrEqual(15);
    expect((await call(client, 'get_team', { groupId: 999 })).status).toBe('not_found');
  });

  test('keeps stale rankings but never replaces unknown old cache time with snapshot generation', async () => {
    const client = await connect(source([board({ stale: true, error: 'secret upstream token' })], { getBoardFetchedAt: undefined }));
    const out = await call(client, 'query_leaderboard', { boardId: 'total' });
    expect(out.rows).toHaveLength(1);
    expect(out.meta).toMatchObject({ stale: true, fetchedAt: null, generatedAt: iso(NOW) });
    expect(JSON.stringify(out)).not.toContain('secret upstream token');
  });

  test('distinguishes missing board, empty data and safe upstream errors', async () => {
    const client = await connect(source([board({ rows: [], error: 'token=secret' })]));
    expect((await call(client, 'query_leaderboard', { boardId: 'total' })).status).toBe('upstream_error');
    expect((await call(client, 'query_leaderboard', { boardId: 'q999' })).status).toBe('not_found');
    const broken = await connect(source([], { getSnapshot: async () => { throw new Error('token=secret'); } }));
    const out = await call(broken, 'query_leaderboard', { boardId: 'total' });
    expect(out).toMatchObject({ ok: false, status: 'upstream_error' });
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  test('uses shared cutoff/tie rules and scoped province ranks without claiming official promotion', async () => {
    const rows = [row({ rank: 1, score: 100 }), row({ rank: 2, groupId: 2, score: 80 }), row({ rank: 2, groupId: 3, score: 80 }), row({ rank: 4, groupId: 4, score: 50 })];
    const client = await connect(source([board({ rows })]));
    const out = await call(client, 'analyze_cutoff', { boardId: 'total', rank: 2, groupId: 4, province: '北京市' });
    expect(out).toMatchObject({ targetRank: 2, cutoffScore: 80, gap: 30, scope: 'province' });
    expect(out).not.toHaveProperty('caveats');
    expect(out.cutoffBasis).toBe('按名次排序后第 rank 行的分数');
    expect((await call(client, 'analyze_cutoff', { boardId: 'total' })).cutoffScore).toBeNull();
    expect((await call(client, 'analyze_cutoff', { boardId: 'playoff-combined' })).targetRank).toBe(50);
  });

  test('predicts from shared history and returns timing statistics not live evaluation state', async () => {
    const client = await connect();
    const out = await call(client, 'predict_score_time', { boardId: 'q600071', submittedAt: iso(NOW) });
    expect(out).toMatchObject({ ok: true, status: 'ok', supported: true });
    expect(out.prediction.etaMs).toBeGreaterThan(NOW);
    expect(out.timing.samples).toBe(12);
    expect(out).not.toHaveProperty('caveats');
    expect(out).toMatchObject({ boardId: 'q600071', questionId: 600071, predictionBoardId: 'q600071' });
    expect(out).not.toHaveProperty('evaluationStatus');
  });

  test('refuses stale cache, unknown fetch time, old samples and insufficient samples', async () => {
    for (const s of [
      source(undefined, { getBoardFetchedAt: async () => NOW - 120001 }),
      source(undefined, { getBoardFetchedAt: async () => NOW + 1000 }),
      source(undefined, { getBoardFetchedAt: undefined }),
      source([board({ id: 'q600071', kind: 'track', rows: samples(), stale: true })]),
      source([board({ id: 'q600071', kind: 'track', rows: samples().map((r) => ({ ...r, bestSubmit: iso(NOW - 4 * 86400000), updated: iso(NOW - 3 * 86400000) })) })]),
    ]) {
      const out = await call(await connect(s), 'predict_score_time', { boardId: 'q600071', submittedAt: iso(NOW) });
      expect(out.status).toBe('refused');
      expect(out.prediction).toBeNull();
    }
  });

  test('playoff question and board aliases share combined-source ETA with three completed samples', async () => {
    const calls: string[] = [];
    const rows = samples().slice(-3).map((r) => playoffRow({ groupId: r.groupId, submittedAt: Date.parse(r.bestSubmit!), evaluatedAt: Date.parse(r.updated!) }));
    const client = await connect(source(undefined, { getPlayoffLeaderboard: async (_qid, key) => { calls.push(key); return playoff(key, { rows, total: rows.length }); } }));
    const predictions: unknown[] = [];
    for (const boardId of ['q600081', 'playoff-combined', 'playoff-performance', 'playoff-prompt']) {
      const out = await call(client, 'predict_score_time', { boardId, submittedAt: iso(NOW) });
      expect(out).toMatchObject({ status: 'ok', supported: true, boardId, questionId: 600081, predictionBoardId: 'q600081', board: { boardId: 'playoff-combined' }, timing: { samples: 3, keptSamples: 3 } });
      expect(out.prediction.etaMs).toBeGreaterThan(NOW);
      expect(out).not.toHaveProperty('caveats');
      predictions.push(out.prediction);
    }
    expect(calls).toEqual(['combined', 'combined', 'combined', 'combined']);
    expect(predictions.every((p) => JSON.stringify(p) === JSON.stringify(predictions[0]))).toBe(true);
  });

  test('uses actual playoff entry identity without labeling another question as q600081', async () => {
    const base = source();
    const requests: number[] = [];
    const rows = samples().slice(-3).map((r) => playoffRow({ submittedAt: Date.parse(r.bestSubmit!), evaluatedAt: Date.parse(r.updated!) }));
    const client = await connect(source(undefined, {
      getPlayoffEntry: async () => { const entry = await base.getPlayoffEntry(); return { ...entry, value: { ...entry.value, questionId: 600099 } }; },
      getPlayoffLeaderboard: async (qid, key) => { requests.push(qid); return playoff(key, { rows }); },
    }));
    expect((await call(client, 'predict_score_time', { boardId: 'q600081', submittedAt: iso(NOW) })).status).toBe('not_found');
    expect(requests).toEqual([]);
    for (const boardId of ['playoff-combined', 'playoff-performance', 'playoff-prompt', 'q600099']) {
      const out = await call(client, 'predict_score_time', { boardId, submittedAt: iso(NOW) });
      expect(out).toMatchObject({ status: 'ok', boardId, questionId: 600099, predictionBoardId: 'q600099' });
    }
    expect(requests).toEqual([600099, 600099, 600099, 600099]);
    const discovered = await call(client, 'list_boards');
    for (const b of discovered.boards.filter((b: any) => b.boardId.startsWith('playoff-'))) expect(b.predictionBoardId).toBe('q600099');
  });

  test('playoff with empty rows or submission-only rows reports no completed samples', async () => {
    for (const rows of [[], [playoffRow()], Array.from({ length: 4 }, (_, i) => playoffRow({ groupId: i + 1, submittedAt: NOW - (i + 1) * 60000 }))]) {
      const client = await connect(source(undefined, { getPlayoffLeaderboard: async (_qid, key) => playoff(key, { rows, total: rows.length }) }));
      const out = await call(client, 'predict_score_time', { boardId: 'q600081', submittedAt: iso(NOW) });
      expect(out).toMatchObject({ status: 'insufficient_data', supported: true, boardId: 'q600081', questionId: 600081, prediction: null, reason: '暂无出分样本', timing: { samples: 0, keptSamples: 0 } });
      expect(out).not.toHaveProperty('caveats');
    }
  });

  test('one or two completed samples retain per-question support and report insufficient data', async () => {
    for (const n of [1, 2]) {
      const rows = samples().slice(-n).map((r) => playoffRow({ groupId: r.groupId, submittedAt: Date.parse(r.bestSubmit!), evaluatedAt: Date.parse(r.updated!) }));
      const client = await connect(source(undefined, { getPlayoffLeaderboard: async (_qid, key) => playoff(key, { rows, total: rows.length }) }));
      const out = await call(client, 'predict_score_time', { boardId: 'q600081', submittedAt: iso(NOW) });
      expect(out).toMatchObject({ status: 'insufficient_data', supported: true, prediction: null, reason: '出分样本不足3条', timing: { samples: n } });
    }
    const initial = await connect(source([board({ id: 'q600071', kind: 'track', rows: samples().slice(0, 2) })]));
    expect((await call(initial, 'predict_score_time', { boardId: 'q600071', submittedAt: iso(NOW) })).status).toBe('insufficient_data');
  });

  test('playoff retains freshness checks and excludes invalid completed sample pairs', async () => {
    const invalid = [playoffRow({ submittedAt: NOW - 120000, evaluatedAt: NOW + 1000 }), playoffRow({ submittedAt: NOW - 60000, evaluatedAt: NOW - 120000 }), playoffRow({ submittedAt: null, evaluatedAt: NOW - 1000 })];
    const client = await connect(source(undefined, { getPlayoffLeaderboard: async (_qid, key) => playoff(key, { rows: invalid }) }));
    const out = await call(client, 'predict_score_time', { boardId: 'q600081', submittedAt: iso(NOW) });
    expect(out).toMatchObject({ status: 'insufficient_data', reason: '暂无出分样本', prediction: null });
    const stale = await connect(source(undefined, { getPlayoffLeaderboard: async (_qid, key) => playoff(key, { at: NOW - 120001 }) }));
    expect((await call(stale, 'predict_score_time', { boardId: 'q600081', submittedAt: iso(NOW) })).status).toBe('refused');
  });

  test('result payloads and tool descriptions contain no disclaimer caveats', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) expect(tool.description).not.toMatch(/不保证|非官方|官方承诺|拒绝|不能据此认定|免责/);
    for (const [name, args] of [['get_team', { groupId: 1 }], ['analyze_cutoff', { boardId: 'total' }], ['predict_score_time', { boardId: 'q600071', submittedAt: iso(NOW) }]] as const) {
      const out = await call(client, name, args);
      expect(out).not.toHaveProperty('caveats');
      expect(JSON.stringify(out)).not.toMatch(/不保证|非官方|官方承诺|拒绝|不能据此认定|免责/);
    }
  });

  test('cold fetch observation uses completion time rather than misclassifying newly fetched caches as future', async () => {
    let clock = NOW;
    const s = source(undefined, {
      now: () => clock,
      getSnapshot: async () => { clock = NOW + 5000; return { campId: 21, generatedAt: iso(clock), boards: [board({ id: 'q600071', kind: 'track', rows: samples() })] }; },
      getBoardFetchedAt: async () => clock,
    });
    const client = await connect(s);
    const out = await call(client, 'predict_score_time', { boardId: 'q600071', submittedAt: iso(NOW + 3000) });
    expect(out).toMatchObject({ status: 'ok', meta: { stale: false, ageSeconds: 0 }, checkedAt: iso(NOW + 5000) });
    expect(out.prediction.etaMs).toBeGreaterThan(NOW + 5000);
  });

  test('marks every response with checkedAt including unsupported and upstream failures', async () => {
    const client = await connect();
    for (const [name, args] of [['list_boards', {}], ['query_leaderboard', { boardId: 'q999' }], ['predict_score_time', { boardId: 'playoff-combined', submittedAt: iso(NOW) }]] as const) {
      expect((await call(client, name, args)).checkedAt).toBe(iso(NOW));
    }
    const broken = await connect(source([], { getSnapshot: async () => { throw new Error('private failure'); } }));
    expect((await call(broken, 'query_leaderboard', { boardId: 'total' })).checkedAt).toBe(iso(NOW));
  });

  test('team results carry stale dependencies even if those boards have no matching group', async () => {
    const client = await connect(source([board(), board({ id: 'q600071', kind: 'track', rows: [row({ groupId: 2 })], stale: true })]));
    const out = await call(client, 'get_team', { groupId: 1 });
    expect(out).toMatchObject({ status: 'partial', meta: { stale: true } });
    expect(out.examinedBoards.find((b: any) => b.boardId === 'q600071').meta.stale).toBe(true);
  });

  test('promotion refuses numeric remaining places when any dependent track cache is old', async () => {
    const client = await connect(source(undefined, { getBoardFetchedAt: async (id) => id === 'total' ? NOW - 1000 : NOW - 120001 }));
    const out = await call(client, 'analyze_cutoff', { boardId: 'total' });
    expect(out.promotion).toMatchObject({ status: 'insufficient', staleBoards: ['q600071'] });
    expect(out.promotion).not.toHaveProperty('remainingPlaces');
  });

  test('keeps total without ETA and validates submit time zone and future timestamps', async () => {
    const client = await connect();
    for (const boardId of ['total']) {
      const out = await call(client, 'predict_score_time', { boardId, submittedAt: iso(NOW) });
      expect(out).toMatchObject({ status: 'unsupported', supported: false, prediction: null });
    }
    for (const submittedAt of ['2026-11-09T12:20:00', 'garbage']) {
      expect((await client.callTool({ name: 'oceanbase_predict_score_time', arguments: { boardId: 'q600071', submittedAt } })).isError).toBe(true);
    }
    expect((await call(client, 'predict_score_time', { boardId: 'q600071', submittedAt: iso(NOW + 3600000) })).status).toBe('refused');
  });
});
