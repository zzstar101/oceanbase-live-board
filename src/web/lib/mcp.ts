import { LIVE_ORIGIN, MODE } from './config.ts';

export function resolveMcpEndpoint({ mode, origin, liveOrigin }: {
  mode: 'server' | 'pages';
  origin: string;
  liveOrigin: string;
}): string {
  return new URL('/api/mcp', mode === 'pages' ? liveOrigin : origin).href;
}

export const MCP_ENDPOINT = resolveMcpEndpoint({
  mode: MODE,
  origin: typeof location === 'undefined' ? LIVE_ORIGIN : location.origin,
  liveOrigin: LIVE_ORIGIN,
});

export function buildMcpConfigs(endpoint: string) {
  return {
    claude: {
      label: 'Claude Code',
      file: '项目根目录 .mcp.json',
      command: `claude mcp add --transport http oceanbase-board ${endpoint}`,
      config: JSON.stringify({ mcpServers: { 'oceanbase-board': { type: 'http', url: endpoint } } }, null, 2),
      source: 'https://code.claude.com/docs/en/mcp',
    },
    codex: {
      label: 'Codex',
      file: '~/.codex/config.toml（或可信项目的 .codex/config.toml）',
      config: `[mcp_servers.oceanbase-board]\nurl = ${JSON.stringify(endpoint)}`,
      source: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    },
    cursor: {
      label: 'Cursor',
      file: '项目 .cursor/mcp.json（或 ~/.cursor/mcp.json）',
      config: JSON.stringify({ mcpServers: { 'oceanbase-board': { url: endpoint } } }, null, 2),
      source: 'https://cursor.com/docs/mcp',
    },
  };
}

export async function copyMcpText(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<string> {
  try {
    if (!clipboard) throw new Error('Clipboard unavailable');
    await clipboard.writeText(text);
    return '已复制';
  } catch {
    return '复制失败，请选择文本手动复制';
  }
}

export const MCP_TOOLS = [
  { name: 'oceanbase_list_boards', args: '{}', title: '发现榜单', description: '列出初赛总榜、训练营赛道与三种加赛榜，先确认可用的 boardId。' },
  { name: 'oceanbase_query_leaderboard', args: '{ boardId, query?, province?, offset?, limit? }', title: '搜索与分页', description: '按队伍、学校搜索，按省份筛选。默认 20 条，最多 100 条；保留全局名次并给出省内名次。' },
  { name: 'oceanbase_get_team', args: '{ groupId }', title: '查看队伍', description: '使用数字队伍 ID（groupId）关联初赛各赛题与加赛成绩。' },
  { name: 'oceanbase_analyze_cutoff', args: '{ boardId, rank?, groupId?, province? }', title: '分析分数线', description: '初赛默认第 100 名、加赛默认第 50 名；可比较指定队伍差距。省份筛选后按省内重算。' },
  { name: 'oceanbase_predict_score_time', args: '{ boardId, submittedAt }', title: '估计赛题出分时间', description: 'boardId 使用初赛或加赛赛题 qID，如 q600081；提交时间带时区。暂无样本显示“暂无出分样本”，样本齐备后返回估计与 80% 区间。' },
] as const;

export const MCP_QUESTIONS = [
  '现在有哪些榜单？请列出可用的 boardId 和数据更新时间。',
  '查总榜里四川省的队伍，列出前 20 支及其全局名次、省内名次。',
  '分析加赛总榜第 50 名的分数线，比较我与分数线的差距。',
  '查询 groupId 为 12345 的队伍在各赛题的成绩。',
  '我在加赛赛题 q600081 于 2026-11-09T12:00:00+08:00 提交，请估计出分时刻与区间。',
] as const;
