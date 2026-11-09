import { describe, expect, test } from 'bun:test';
import { createApi } from '../src/server/app.ts';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpDataSource } from '../src/server/mcp-tools.ts';
import type { Snapshot } from '../src/shared/types.ts';
import { normalizePlayoffLeaderboard } from '../src/server/playoff.ts';

const app = createApi({ runtime: 'bun', pushIntervalMs: null });
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
function rpc(method: string, params?: unknown, extra: Record<string, string> = {}) {
  return app.request('http://localhost/api/mcp', {
    method: 'POST', headers: { ...headers, ...extra },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
}

describe('stateless Streamable HTTP MCP', () => {
  test('initializes with standard MCP negotiation without a key/session', async () => {
    const res = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('mcp-session-id')).toBeNull();
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('oceanbase-live-board');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.instructions).toContain('preliminary and playoff ETA');
    expect(body.result.instructions).not.toMatch(/not an official|No submissions/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  test('lists five annotated tools independently without fetching upstream', async () => {
    const res = await rpc('tools/list');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'oceanbase_analyze_cutoff', 'oceanbase_get_team', 'oceanbase_list_boards',
      'oceanbase_predict_score_time', 'oceanbase_query_leaderboard',
    ]);
    for (const tool of body.result.tools) expect(tool.annotations.readOnlyHint).toBe(true);
  });
  test('official HTTP client negotiates, discovers and calls a tool against injected data', async () => {
    const now = Date.now();
    const snapshot: Snapshot = { campId: 21, generatedAt: new Date(now).toISOString(), boards: [{
      id: 'total', title: '总榜', kind: 'total', questionId: null, error: null, stale: false,
      reportedTotal: 1, source: 'https://open.oceanbase.com', rows: [{
        rank: 1, name: '协议测试队', school: '测试大学', province: '四川省', advisor: '', score: 42,
        rawScore: 42000, bestSubmit: null, updated: null, userId: null, groupId: 7, recordId: null,
      }],
    }] };
    const source: McpDataSource = {
      getSnapshot: async () => snapshot,
      getBoardFetchedAt: async () => now,
      now: () => now,
      getPlayoffEntry: async () => { throw new Error('Not needed for this initial query'); },
      getPlayoffLeaderboard: async () => { throw new Error('Not needed for this initial query'); },
    };
    const fixtureApp = createApi({ runtime: 'bun', pushIntervalMs: null, mcpSource: source });
    const client = new Client({ name: 'real-http-client-test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
      fetch: async (input, init) => fixtureApp.fetch(new Request(input, init)),
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(5);
      const result = await client.callTool({ name: 'oceanbase_query_leaderboard', arguments: { boardId: 'total', limit: 1 } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBeDefined();
      expect(JSON.stringify(result.structuredContent)).toContain('协议测试队');
      expect(JSON.stringify(result.structuredContent)).not.toContain('userId');
    } finally { await client.close(); }
  });
  test('predicts playoff question ETA over HTTP from normalized upstream completion samples', async () => {
    const now = Date.now();
    const source: McpDataSource = {
      getSnapshot: async () => ({ campId: 21, generatedAt: new Date(now).toISOString(), boards: [] }),
      getPlayoffEntry: async () => ({ value: { campId: 21, questionId: 600081, questionName: '加赛题', startsAt: now - 3600000, endsAt: now + 3600000, phase: 'ONGOING' }, at: now, stale: false, error: null }),
      getPlayoffLeaderboard: async (_questionId, key) => ({ ...normalizePlayoffLeaderboard(key, {
        rows: Array.from({ length: 12 }, (_, i) => ({
          groupId: i + 1, groupName: `队伍 ${i + 1}`, totalScore: 100,
          submittedAt: now - (14 - i) * 60000,
          evaluatedAt: now - (13 - i) * 60000,
        })),
      }), at: now }),
      now: () => now,
    };
    const fixtureApp = createApi({ runtime: 'bun', pushIntervalMs: null, mcpSource: source });
    const request = (boardId: string) => fixtureApp.request('/api/mcp', {
      method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'oceanbase_predict_score_time', arguments: { boardId, submittedAt: new Date(now - 1000).toISOString() },
      } }),
    });
    const res = await request('q600081');
    expect(res.status).toBe(200);
    const out = (await res.json()).result.structuredContent;
    expect(out).toMatchObject({ ok: true, status: 'ok', supported: true, boardId: 'q600081', questionId: 600081, predictionBoardId: 'q600081' });
    expect(out.prediction.etaMs).toBeGreaterThan(now);
    expect(out).not.toHaveProperty('caveats');
    const total = (await (await request('total')).json()).result.structuredContent;
    expect(total).toMatchObject({ status: 'unsupported', supported: false, prediction: null });
  });
  test('rejects invalid tool inputs and unknown tools without upstream work', async () => {
    const invalid = await rpc('tools/call', { name: 'oceanbase_query_leaderboard', arguments: { boardId: 'total', limit: 10000, force: true } });
    const body = await invalid.json();
    expect(Boolean(body.error || body.result?.isError)).toBe(true);
    const unknown = await rpc('tools/call', { name: 'fetch_url', arguments: { url: 'http://localhost/stats' } });
    const unknownBody = await unknown.json();
    expect(Boolean(unknownBody.error || unknownBody.result?.isError)).toBe(true);
  });
  test('rejects untrusted browser Origins, allowing same local origin and documented Pages', async () => {
    expect((await rpc('tools/list', undefined, { origin: 'https://attacker.invalid' })).status).toBe(403);
    expect((await rpc('tools/list', undefined, { origin: 'null' })).status).toBe(403);
    expect((await rpc('tools/list', undefined, { origin: 'http://localhost' })).status).toBe(200);
    expect((await rpc('tools/list', undefined, { origin: 'https://zzstar101.github.io' })).status).toBe(200);
  });
  test('CORS supports MCP headers', async () => {
    const res = await app.request('/api/mcp', { method: 'OPTIONS', headers: {
      origin: 'https://zzstar101.github.io', 'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,mcp-protocol-version,mcp-session-id',
    } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('mcp-protocol-version');
  });
  test('does not leave GET streams or DELETE sessions open', async () => {
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const res = await app.request('/api/mcp', { method, headers: { accept: 'text/event-stream' } });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toContain('POST');
    }
  });
  test('bounds declared and chunked request bodies before parsing', async () => {
    const tooLarge = JSON.stringify({ padding: 'x'.repeat(33 * 1024) });
    const res = await app.request('/api/mcp', { method: 'POST', headers, body: tooLarge });
    expect(res.status).toBe(413);
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(tooLarge)); controller.close();
    } });
    const chunked = await app.request(new Request('http://localhost/api/mcp', { method: 'POST', headers, body: stream }));
    expect(chunked.status).toBe(413);
  });
  test('malformed JSON, unsupported protocol versions and missing Accept are rejected', async () => {
    expect((await app.request('/api/mcp', { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await rpc('tools/list', undefined, { 'mcp-protocol-version': '1900-01-01' })).status).toBe(400);
    expect((await app.request('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(406);
  });
});
