import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { McpPage } from '../src/web/pages/McpPage.tsx';
import { McpNavLink } from '../src/web/components/McpNavLink.tsx';
import { router } from '../src/web/router.tsx';
import { buildMcpConfigs, copyMcpText, resolveMcpEndpoint } from '../src/web/lib/mcp.ts';

describe('MCP connection configuration', () => {
  test('uses the current server origin, not the documentation path', () => {
    expect(resolveMcpEndpoint({ mode: 'server', origin: 'http://127.0.0.1:8791', liveOrigin: 'https://other.example' })).toBe('http://127.0.0.1:8791/api/mcp');
  });
  test('Pages points to configured liveOrigin, never the static host', () => {
    expect(resolveMcpEndpoint({ mode: 'pages', origin: 'https://user.github.io', liveOrigin: 'https://live.example/' })).toBe('https://live.example/api/mcp');
  });
  test('builds each client format without keys or stdio processes', () => {
    const endpoint = 'https://board.example/api/mcp';
    const configs = buildMcpConfigs(endpoint);
    expect(configs.claude.command).toBe(`claude mcp add --transport http oceanbase-board ${endpoint}`);
    expect(JSON.parse(configs.claude.config)).toEqual({ mcpServers: { 'oceanbase-board': { type: 'http', url: endpoint } } });
    expect(configs.codex.config).toBe(`[mcp_servers.oceanbase-board]\nurl = "${endpoint}"`);
    expect(JSON.parse(configs.cursor.config)).toEqual({ mcpServers: { 'oceanbase-board': { url: endpoint } } });
    for (const client of Object.values(configs)) {
      expect(client.config).not.toMatch(/API_KEY|Authorization|stdio|npx/);
    }
  });
  test('reports copy success only after clipboard resolves', async () => {
    const values: string[] = [];
    expect(await copyMcpText('endpoint', { writeText: async (value) => { values.push(value); } })).toBe('已复制');
    expect(values).toEqual(['endpoint']);
  });
  test('clipboard denial and unavailable APIs provide manual-copy feedback', async () => {
    expect(await copyMcpText('endpoint', { writeText: async () => { throw new Error('denied'); } })).toBe('复制失败，请选择文本手动复制');
    expect(await copyMcpText('endpoint', undefined)).toBe('复制失败，请选择文本手动复制');
  });
});

describe('MCP documentation page', () => {
  test('registers the independent /mcp route', () => {
    expect(Object.keys(router.routesByPath)).toContain('/mcp');
  });
  test('the actual /mcp route renders without any live-data providers', async () => {
    const docsRouter = createRouter({
      routeTree: router.routeTree,
      history: createMemoryHistory({ initialEntries: ['/mcp'] }),
      isServer: true,
    });
    await docsRouter.load();
    const html = renderToStaticMarkup(<RouterProvider router={docsRouter} />);
    expect(html).toContain('让 AI 帮你读榜');
    expect(html).not.toContain('No QueryClient set');
  });
  test('renders standalone without a LiveProvider or QueryClient', () => {
    const html = renderToStaticMarkup(<McpPage endpoint="http://127.0.0.1:8791/api/mcp" />);
    expect(html).toContain('让 AI 帮你读榜');
    expect(html).toContain('href="/mcp#mcp-main"');
    expect(html).toContain('http://127.0.0.1:8791/api/mcp');
    expect(html).toContain('Streamable HTTP');
    expect(html).toContain('免 API Key');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('复制地址');
    expect(html).toContain('复制配置');
    expect(html).toContain('数据与预测');
    for (const phrase of ['先知道这些边界', '不是实时保证', '不保证', '不是承诺', '未实测', '尚未进行客户端实测', '本页不代表', '需发布后', '官方无关', '客户端版本']) expect(html).not.toContain(phrase);
  });
  test('explains per-question ETA, samples and data freshness', () => {
    const html = renderToStaticMarkup(<McpPage endpoint="https://live.example/api/mcp" />);
    for (const name of ['list_boards', 'query_leaderboard', 'get_team', 'analyze_cutoff', 'predict_score_time']) expect(html).toContain(`oceanbase_${name}`);
    expect(html).toContain('120 秒');
    expect(html).toContain('q600081');
    expect(html).toContain('predictionBoardId');
    expect(html).toContain('暂无出分样本');
    expect(html).toContain('80% 区间');
    expect(html).toContain('总榜不提供 ETA');
    expect(html).toContain('三种加赛榜共用');
    expect(html).not.toContain('仅初赛');
    expect(html).not.toContain('加赛不支持');
    expect(html).not.toContain('就不要给 ETA');
    expect(html).toContain('现在有哪些榜单');
    expect(html).not.toContain('导师搜索');
    expect(html).toContain('https://code.claude.com/docs/en/mcp');
    expect(html).toContain('https://learn.chatgpt.com/docs/extend/mcp?surface=cli');
    expect(html).toContain('https://cursor.com/docs/mcp');
  });
  test('keeps MCP documentation aligned with question ETA and the live service URL', async () => {
    const guide = await Bun.file(new URL('../docs/mcp.md', import.meta.url)).text();
    const api = (await Bun.file(new URL('../docs/api.md', import.meta.url)).text()).split('## MCP 只读接口')[1].split('## 上游接口')[0];
    const readme = (await Bun.file(new URL('../README.md', import.meta.url)).text()).split('## 用 AI 读榜（MCP）')[1].split('## 截图')[0];
    for (const text of [guide, api, readme]) {
      expect(text).toContain('q600081');
      expect(text).toContain('暂无出分样本');
      expect(text).not.toMatch(/仅初赛|加赛不支持|尚未进行客户端实测|不保证|不是出分保证|需发布|不代表已/);
      expect(text).not.toContain('https://zzstar101.github.io/oceanbase-live-board/api/mcp');
    }
    expect(guide.match(/https:\/\/board\.nerv-base\.com\/api\/mcp/g)?.length).toBeGreaterThanOrEqual(5);
    expect(guide).toContain('predictionBoardId');
  });
  test('uses the requested Pages site for public links while keeping the remote MCP endpoint', async () => {
    const home = 'https://zzstar101.github.io/oceanbase-live-board/';
    const docs = `${home}mcp`;
    const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
    const guide = await Bun.file(new URL('../docs/mcp.md', import.meta.url)).text();
    const api = await Bun.file(new URL('../docs/api.md', import.meta.url)).text();
    expect(readme).toContain(`**在线看板** <${home}>`);
    expect(readme).not.toContain('**备用版**');
    for (const text of [readme, guide, api]) {
      expect(text).toContain(docs);
      expect(text).toContain('https://board.nerv-base.com/api/mcp');
      expect(text).not.toContain(`${home}api/mcp`);
    }
    expect(resolveMcpEndpoint({ mode: 'pages', origin: new URL(home).origin, liveOrigin: 'https://board.nerv-base.com' })).toBe('https://board.nerv-base.com/api/mcp');
  });
  test('offers a mobile-visible homepage entry respecting Pages basepath', () => {
    const html = renderToStaticMarkup(<McpNavLink basepath="/oceanbase-live-board" />);
    expect(html).toContain('href="/oceanbase-live-board/mcp"');
    expect(html).toContain('MCP');
    expect(html).not.toMatch(/class="[^"]*\bhidden\b/);
    expect(renderToStaticMarkup(<McpNavLink basepath="/" />)).toContain('href="/mcp"');
  });
});
