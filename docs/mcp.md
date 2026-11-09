# MCP：让 AI 帮你读榜

公开、只读、免 API Key 的 **Streamable HTTP MCP** 接口位于 `/api/mcp`。连接 Claude Code、Codex 或 Cursor 后，可以发现榜单、搜索队伍、分析分数线，估计初赛与加赛赛题的出分时间。

## 入口与服务地址

- 看板首页：[OceanBase 榜单看板](https://zzstar101.github.io/oceanbase-live-board/)。
- 接入文档：[MCP 接入](https://zzstar101.github.io/oceanbase-live-board/mcp)。
- 远程 MCP 服务：`https://board.nerv-base.com/api/mcp`。
- 本地服务：`http://127.0.0.1:8791/api/mcp`，端口随本地配置变化。
- 自建服务：`https://你的实时服务域名/api/mcp`。

GitHub Pages 托管静态文档页 `/mcp`，页面中的 MCP 地址由配置的 `liveOrigin` 拼接 `/api/mcp`；实时站与本地文档页使用当前同源地址。首页 Header 的「MCP」入口在手机上也可见。文档页独立展示接入说明，可复制地址、配置与 CLI 命令，剪贴板不可用时提示手动复制。

## 客户端配置

下面使用实时服务地址。本地使用时将 URL 换成本地地址；连接免 Key，已有配置合并 `oceanbase-board` 服务项即可。

### Claude Code

按 [Claude Code 官方 MCP 文档](https://code.claude.com/docs/en/mcp)，使用 HTTP transport：

```bash
claude mcp add --transport http oceanbase-board https://board.nerv-base.com/api/mcp
```

命令默认使用本地作用域。项目共享配置写入根目录 `.mcp.json`：

```json
{
  "mcpServers": {
    "oceanbase-board": {
      "type": "http",
      "url": "https://board.nerv-base.com/api/mcp"
    }
  }
}
```

保存后在 Claude Code 的 MCP 管理界面检查连接、启用服务并查看工具。

### Codex

按 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，在 `~/.codex/config.toml`，或可信项目的 `.codex/config.toml` 合并：

```toml
[mcp_servers.oceanbase-board]
url = "https://board.nerv-base.com/api/mcp"
```

通过 `codex mcp list` 或交互界面 `/mcp` 查看连接与工具。

### Cursor

按 [Cursor 官方 MCP 文档](https://cursor.com/docs/mcp)，在项目 `.cursor/mcp.json`，或全局 `~/.cursor/mcp.json` 合并：

```json
{
  "mcpServers": {
    "oceanbase-board": {
      "url": "https://board.nerv-base.com/api/mcp"
    }
  }
}
```

保存后在 Cursor 的 MCP 设置中启用服务并查看工具列表。

## 五个只读工具

字段为必填，带 `?` 为可选。参数对象严格校验。

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| `oceanbase_list_boards` | `{}` | 发现榜单 ID、名称、来源、时效与预测赛题 ID `predictionBoardId` |
| `oceanbase_query_leaderboard` | `{ boardId: string, query?: string, province?: string, offset?: number, limit?: number }` | 按队伍、学校搜索，按省份筛选；`offset` 默认 0，`limit` 默认 20、最大 100 |
| `oceanbase_get_team` | `{ groupId: number }` | 按数字队伍 ID 关联初赛各赛题与加赛成绩 |
| `oceanbase_analyze_cutoff` | `{ boardId: string, rank?: number, groupId?: number, province?: string }` | 分数线与队伍差距；初赛默认第 100 名，加赛默认第 50 名 |
| `oceanbase_predict_score_time` | `{ boardId: string, submittedAt: string }` | 按赛题估计出分时刻与 80% 区间；提交时间使用带时区的 ISO 格式 |

### 榜单与赛题 ID

查询榜单的 `boardId`：初赛总榜 `total`、初赛赛题 `q600071` 等，以及加赛 `playoff-combined` / `playoff-performance` / `playoff-prompt`。

预测的 `boardId` 使用**赛题 qID**：初赛 `q600071` 等、加赛 `q600081`。三种加赛榜共用 `q600081` 赛题的 ETA 模型，总榜不提供 ETA。可从 `oceanbase_list_boards` 的 `predictionBoardId` 获取对应预测 ID。

`province` 使用省份全称（例如 `四川省`），`__none__` 表示未填省份。过滤后保留全局名次并重算省内名次；分数线按所选范围的第 `rank` 行分析。

## 数据与预测

每次响应顶层 `checkedAt` 表示检查时间。榜单元数据包含：

```ts
meta: {
  fetchedAt: string | null;      // 数据抓取时间，ISO
  generatedAt?: string;         // 快照生成时间
  stale: boolean;
  ageSeconds: number | null;
  staleAfterSeconds: 120;
  warnings: string[];
}
```

超过 120 秒或抓取时间未知时标记为 `stale`。榜单同时提供来源 `source`；加赛学校、省份补充信息使用独立缓存，其抓取时间通过 `warnings` 说明。跨榜查询按 `groupId` 关联，最多检查 15 个榜单，`examinedBoards: [{ boardId, meta }]` 记录每个已检查榜单的时效。

ETA 使用赛题的提交时间与评测完成时间构建历史样本，初赛复用现有模型（见 [出分预测](prediction.md)），加赛使用 `q600081` 的赛题样本。暂无样本时显示**“暂无出分样本”**（`insufficient_data`），1–2 条样本时显示“出分样本不足 3 条”；至少 3 条有效样本且数据状态就绪后，返回预计出分时刻与 **80% 区间**。`lowMs` / `highMs` 为预测区间字段。数据时效与样本准备状态一并返回。

业务结果的 `ok` / `status` 区分成功、空榜 `empty`、未找到 `not_found`、不支持 `unsupported`、上游错误 `upstream_error` 及预测状态。晋级分析依赖缺失或过期赛题时，`promotion.status` 为 `insufficient`，并返回 `missingTracks`、`staleBoards` 与 `dependencies`。

## 可以这样问

- “现在有哪些榜单？请给出 boardId、predictionBoardId 和数据更新时间。”
- “查总榜四川省前 20 支队伍，列出全局名次和省内名次。”
- “分析加赛总榜第 50 名分数线，比较我与分数线的差距。”
- “查询 groupId 为 12345 的队伍在各赛题的成绩。”
- “我在加赛赛题 q600081 于 2026-11-09T12:00:00+08:00 提交，请估计出分时刻与区间。”

将示例的队伍 ID、赛题 ID 与提交时间替换为实际值。

官方配置来源：[Claude Code](https://code.claude.com/docs/en/mcp) · [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) · [Cursor](https://cursor.com/docs/mcp)。
