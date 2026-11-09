# 接口

Bun 本地服务与 Cloudflare Worker 共用同一套 Hono 路由（`src/server/app.ts`），全部允许跨域。

| 路由 | 说明 |
| --- | --- |
| `GET /api/health` | 存活、campId、缓存 TTL、运行时、是否开启推送 / 统计 |
| `POST /api/mcp` | 公开只读、免 Key 的 Streamable HTTP MCP（JSON-RPC）；客户端接入与五个工具见 [MCP 接入](mcp.md) |
| `GET /mcp` | 独立 MCP 文档页；不依赖榜单获取或实时连接，Pages 下指向配置的 `liveOrigin` |
| `GET /api/snapshot[?force=1]` | 总榜 + 全部赛道（约 1.3 MB，gzip 后约 200 KB）；`X-Source` 头说明来源；所有榜单都为空时 502 |
| `GET /api/board/<id>` | 单个榜单，`id` = `total` / `q600071` / `600071` |
| `GET /api/playoff` | 加赛首屏：入口、提测配置、题目介绍（`entry` / `submission` / `question`） |
| `GET /api/playoff/leaderboard?board=combined\|performance\|prompt[&questionId=600081]` | 加赛榜；不传 `questionId` 时服务端从 `playoff/entry` 取 |
| `GET /api/playoff/export.csv?board=combined\|performance\|prompt[&province=<省份全称>]` | 加赛榜 CSV；学校/省份/导师按 `groupId` 从初赛快照补齐 |
| `GET /api/export.csv?board=<id>[&province=<省份全称>]` | CSV（UTF-8 BOM，含省份列）；`province=__none__` 导出未填省份的 |
| `GET /api/online` | 实时推送连接数 `{ sockets, lastPush, intervalMs }` |
| `WS /api/stream` | 推送：每帧是 gzip 后的快照 JSON（浏览器用 `DecompressionStream` 解） |
| `POST /api/hit` | 匿名打点 `{k:"pv"\|"board"\|"csv"\|"out"\|"predict"\|"province"\|"ad", t?, r?}`，204；格式错 400 |
| `GET /api/stats?days=14` | 统计汇总，需 `Authorization: Bearer <STATS_KEY>`（或 `?key=`）；key 错 404，未配置 503；`days` 夹到 1–60 |

数据结构见 `src/shared/types.ts`（`Snapshot` / `Board` / `Row` / `StatsSummary`）。

## MCP 只读接口

`/api/mcp` 是公开只读、免 API Key 的 Streamable HTTP JSON-RPC 服务，支持 `initialize`、`tools/list` 和 `tools/call`。远程服务地址：`https://board.nerv-base.com/api/mcp`；公开文档页：[MCP 接入](https://zzstar101.github.io/oceanbase-live-board/mcp)，从 [Pages 首页](https://zzstar101.github.io/oceanbase-live-board/) 顶栏进入。

| 工具 | 参数 |
| --- | --- |
| `oceanbase_list_boards` | `{}` |
| `oceanbase_query_leaderboard` | `{ boardId: string, query?: string, province?: string, offset?: number, limit?: number }` |
| `oceanbase_get_team` | `{ groupId: number }` |
| `oceanbase_analyze_cutoff` | `{ boardId: string, rank?: number, groupId?: number, province?: string }` |
| `oceanbase_predict_score_time` | `{ boardId: string, submittedAt: string }` |

查询榜单 ID 使用 `total`、`q600071` 等初赛赛题，以及 `playoff-combined` / `playoff-performance` / `playoff-prompt`。分页默认 `offset=0`、`limit=20`，最多 100 条，参数严格校验。队伍跨榜成绩按数字 `groupId` 关联；分数线按所选榜单或省份范围计算。

预测 `boardId` 使用赛题 qID：初赛 `q600071` 等，加赛 `q600081`；三种加赛榜共用该赛题的 ETA 模型，总榜不提供 ETA。发现工具返回 `predictionBoardId`。暂无样本时显示“暂无出分样本”（`insufficient_data`），至少 3 条有效提交 / 出分样本且数据状态就绪后，返回预计出分时刻与 80% 区间。

结果含 `fetchedAt`、数据年龄、`stale` 和告警，响应顶层 `checkedAt` 表示检查时间。超过 120 秒或抓取时间未知时标记为 `stale`。空榜、队伍未找到、上游错误与样本准备情况分别通过业务状态说明。

地址选择、完整元数据、三种客户端配置及官方来源见 [MCP 接入](mcp.md)。

## 上游接口与踩过的坑

```
题目列表  GET https://openwebapi.oceanbase.com/api/techcamp/testplatform/question/webQueryTestPlatformQuestionList
             ?rpcFromType=0&campId=21&pageSize=200&pageNo=1
赛道榜    GET .../testplatform/score/queryTestPlatformScoreList?questionId=600071&pageSize=5000
总榜      GET .../testplatform/score/queryCompetitionScoreList
             ?rpcFromType=0&pageNo=1&pageSize=5000&campId=21&scoreType=0
```

- `queryTestPlatformScoreList` 忽略 `pageNum`，`pageSize` 等价于 LIMIT，`total` 只是本次返回条数。
- `queryCompetitionScoreList` 是真分页，必须同时带 `campId` 与 `scoreType=0`。
- 赛道榜每行是「该队最优那次提交」：`gmtCreate` = 提交时刻，`gmtModified` = 出分时刻（只在提分时一起变），两者之差就是这次提交的真实耗时。
- 赛道榜的 `userId` 只是「交的那个成员」，和总榜按 `userId` 只能对上 62–90%；**`groupId`（队伍 id）100% 对得上**，所以队伍关联、学校 / 省份补全全部按 `groupId`。
- 名次由本项目按成绩重新排（稳定排序，同分并列 1,1,1,4），不依赖接口顺序。

## 加赛（playoff）

加赛题 `600081`（轻量向量数据库 MiniVectorDB）不走初赛的 `queryTestPlatformScoreList`——该接口对
`600081` 返回 500「提测一级题目未创建」。加赛使用独立接口：

```
入口      GET .../testplatform/playoff/entry?campId=21
榜单      GET .../testplatform/playoff/leaderboard?questionId=600081&board=combined|performance|prompt&pageNo=1&pageSize=100
提测配置  GET .../testplatform/taskrecord/submissionOptions?questionId=600081
个人记录  GET .../testplatform/playoff/participation?questionId=600081   # 需登录 cookie，公开抓取不可用
```

- `combined` 榜的 `pageSize` 超过 100 会返回 500「加赛榜分页参数无效」；20 偶尔也会触发。服务端统一用 `100`，且不带 `rankLimit`。
- 三个榜都返回 `rows`；`combined` 额外要求 `performanceTop` / `promptTop` 是数组（官方前端会校验）。
- `submissionOptions` 返回 `submissionType=CODE`、`evaluationMode=STANDARD_PULL`、`resultFormat=PLAYOFF`、`maxScore=80`、`repoSlot=gitUrlPlus`，即「提交 Git 仓库地址，平台自动拉取评测」。
- `participation` 需要登录态，因此公开站点只能展示榜单和提测配置，不能展示「我的提测记录」。
- 加赛有晋级名额，取前 50 名；页面「晋级形势」按当前第 50 名分数做临时晋级线分析，官方榜单页面展示前 80 名（含并列），最终以官方规则为准。
- `playoff/entry.startsAt` 当前返回 15:00，但官方提测实际从 12:00 开始；页面状态、倒计时和赛程按 12:00 展示。
- 加赛榜接口在 Worker 边缘缓存 30 秒（stale 120 秒），页面每 30 秒轮询一次，避免开赛后高频请求打满免费额度。
- 加赛 ETA 已按赛题 `q600081` 接入：`submittedAt` 为提交时间，规范化字段 `evaluatedAt` 为评测完成时间（毫秒），按上游 `evaluatedAt` / `completedAt` / `updatedAt` 的顺序解析。三种分榜共用该赛题的样本模型；暂无出分样本时返回 `insufficient_data`，1–2 条样本时显示“出分样本不足 3 条”，样本齐备后给出预计出分时刻与 80% 区间。
