import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { defaultMcpDataSource, registerBoardTools } from '../src/server/mcp-tools.ts';
import { clearCache, configure, getConfig, getSnapshot, getTotalBoard, setFetch, type FetchFn } from '../src/server/upstream.ts';

const START = Date.parse('2026-11-09T04:20:00Z');
let clock = START;
let originalConfig = { ...getConfig() };
let timeSpy: ReturnType<typeof spyOn>;
const clients: Client[] = [];
beforeEach(() => {
  originalConfig = { ...getConfig() };
  configure({ ttlMs: 12_000 });
  clearCache();
  clock = START;
  timeSpy = spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  timeSpy.mockRestore();
  clearCache();
  configure(originalConfig);
  setFetch((input, init) => fetch(input, init));
});
async function connect() {
  const server = new McpServer({ name: 'default-source-test', version: '1' });
  registerBoardTools(server);
  const client = new Client({ name: 'default-source-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  clients.push(client);
  return client;
}
const response = (data: unknown) => Response.json({ code: 200, data });
const question = { id: 600071, questionName: '赛道', sort: 1 };

describe('MCP default source uses atomic upstream data', () => {
  test('does not refresh a cache timestamp separately from rows when snapshot work crosses TTL', async () => {
    let totalCalls = 0;
    const mockFetch: FetchFn = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('queryCompetitionScoreList')) {
        totalCalls++;
        return response({ list: [{ groupId: 1, groupName: 'original', webTotalScore: totalCalls === 1 ? 100 : 999 }], total: 1 });
      }
      if (url.pathname.endsWith('webQueryTestPlatformQuestionList')) {
        // totalP already captured the cached rows; discovering tracks now takes >120 seconds.
        clock = START + 130_001;
        return response({ list: [question] });
      }
      if (url.pathname.endsWith('queryTestPlatformScoreList')) return response({ list: [] });
      throw new Error('Unexpected test URL');
    };
    setFetch(mockFetch);
    await getTotalBoard();
    clock = START + 11_999; // still within the original 12-second TTL at snapshot entry
    const client = await connect();
    const result = await client.callTool({ name: 'oceanbase_query_leaderboard', arguments: { boardId: 'total' } });
    const out = result.structuredContent as Record<string, any>;
    expect(out.rows[0].score).toBe(100);
    expect(out.meta).toMatchObject({ fetchedAt: new Date(START).toISOString(), stale: true, ageSeconds: 130.001 });
    expect(totalCalls).toBe(1);
  });

  test('fresh track scores warn about atomically captured old total metadata without refetching it', async () => {
    let totalCalls = 0;
    setFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('queryCompetitionScoreList')) {
        totalCalls++;
        return response({ list: [{ groupId: 1, groupName: 'group-one', webTotalScore: 100, graduationSchool: 'Old school', provinceName: '四川省' }], total: 1 });
      }
      if (url.pathname.endsWith('webQueryTestPlatformQuestionList')) { clock = START + 130_001; return response({ list: [question] }); }
      if (url.pathname.endsWith('queryTestPlatformScoreList')) return response({ list: [{ groupId: 1, userName: 'track-member', webTotalScore: 80 }] });
      throw new Error('Unexpected test URL');
    });
    await getTotalBoard();
    clock = START + 11_999;
    const client = await connect();
    const result = await client.callTool({ name: 'oceanbase_query_leaderboard', arguments: { boardId: 'q600071' } });
    const out = result.structuredContent as Record<string, any>;
    expect(out.rows[0]).toMatchObject({ score: 80, school: 'Old school', province: '四川省' });
    expect(out.meta).toMatchObject({ stale: false, fetchedAt: new Date(START + 130_001).toISOString() });
    expect(out.meta.warnings.join('')).toContain(new Date(START).toISOString());
    expect(out.meta.warnings.join('')).toContain('学校和省份');
    expect(totalCalls).toBe(1);
  });

  test('MCP snapshot enrichment only joins groupId while the website keeps its legacy fallback', async () => {
    const mockFetch: FetchFn = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('queryCompetitionScoreList')) return response({ list: [{ groupId: 1, userId: 'shared-user', groupName: 'group-one', webTotalScore: 100, graduationSchool: 'Private association', provinceName: '四川省' }], total: 1 });
      if (url.pathname.endsWith('webQueryTestPlatformQuestionList')) return response({ list: [question] });
      if (url.pathname.endsWith('queryTestPlatformScoreList')) return response({ list: [
        { groupId: 2, userId: 'shared-user', userName: 'wrong-group', webTotalScore: 80 },
        { groupId: 1, userId: 'other-user', userName: 'same-group', webTotalScore: 70 },
        { userId: 'shared-user', userName: 'no-group', webTotalScore: 60 },
      ] });
      throw new Error('Unexpected test URL');
    };
    setFetch(mockFetch);
    const website = await getSnapshot();
    expect(website.boards[1].rows[0].school).toBe('Private association');
    const strict = await defaultMcpDataSource.getSnapshot();
    expect(strict.boards[1].rows[0]).toMatchObject({ groupId: 2, school: '', province: '' });
    expect(strict.boards[1].rows[1]).toMatchObject({ groupId: 1, school: 'Private association', province: '四川省' });
    expect(strict.boards[1].rows[2]).toMatchObject({ groupId: null, school: '', province: '' });
    expect(strict.boards[0].fetchedAt).toBe(START);
    expect(strict.boards[1].fetchedAt).toBe(START);
  });
});
