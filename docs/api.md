# 接口

Bun 本地服务与 Cloudflare Worker 共用同一套 Hono 路由（`src/server/app.ts`），全部允许跨域。

| 路由 | 说明 |
| --- | --- |
| `GET /api/health` | 存活、campId、缓存 TTL、运行时、是否开启推送 / 统计 |
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
- 官方前端目前只使用 `rows[].submittedAt`（成绩提交时间），没有展示评测开始/完成时间；但开赛前 rows 为空，不能据此断定上游不返回这些字段。开赛后需抓原始 row 核对；若包含评测时间，再接入真实耗时/ETA。
