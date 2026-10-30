# 本地开发

需要 [Bun](https://bun.sh) ≥ 1.4.4（版本固定在 `package.json` 的 `packageManager`，CI 读同一个字段）。

```bash
bun install
bun run dev          # → http://127.0.0.1:8791
```

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 开发服务：`Bun.serve` + HTML import，前端由 Bun 原生打包，改代码自动重启 |
| `bun run start` | 生产模式（启动时打包、压缩） |
| `bun test` | 单元测试：上游解析 / 缓存 / CSV / API / 统计 / 耗时模型 / 预测 / 洞察 / 晋级 |
| `bun run typecheck` | 生成 Worker 运行时类型（`wrangler types`）并检查前端 + 服务端 + Worker 两个 tsconfig |
| `bun run types` | 只重新生成 `worker-configuration.d.ts`（改了 `wrangler.jsonc` 后运行） |
| `bun run backtest` | 出分预测回测（`--md` 输出 Markdown 表格），见 [prediction.md](prediction.md) |
| `bun run build` | 打包前端到 `dist/client`（`Bun.build` + Tailwind 插件） |
| `bun run build:pages` | 构建 GitHub Pages 静态版到 `dist/pages`（含一份快照） |
| `bun run worker:dev` | 打包后用 `wrangler dev` 本地跑 Worker |

## 技术栈

尽量用平台原生能力，运行时依赖只有 6 个包（全部为当前最新大版本）。

| 层 | 用了什么 |
| --- | --- |
| 运行时 | **Bun 1.4**：`Bun.serve` 路由 + HTML import、WebSocket pub/sub（`server.publish` / `subscriberCount`）、`Bun.gzipSync`、`bun:sqlite`、`Bun.build`、`bun test` |
| API | **Hono 4**：同一套路由跑在 Bun 与 Cloudflare Worker 上 |
| 前端 | **React 19**（`use()`、`<Context value>`、组件内 `<title>`、ref 回调）+ **TanStack** Query 5 · Router 1（URL 即状态）· Table 9（排序）+ **Tailwind CSS 4** |
| 浏览器原生 | `<dialog closedby>` + `form method="dialog"`、`DecompressionStream`、CSS `content-visibility`（代替虚拟滚动）、`color-mix()`、`prefers-color-scheme`、`sendBeacon`、`Intl.Collator`、`Array#toSorted`、迭代器 helpers、手写 SVG 图表 |
| 边缘 | **Cloudflare Workers**：Durable Objects（RPC、WebSocket Hibernation、alarm、SQLite 后端同步 KV `ctx.storage.kv`）、Cache API、`CompressionStream`；绑定类型由 `wrangler types` 生成 |
| 语言 | **TypeScript 7**（`tsc` 原生版），`target: ESNext` |

## 目录结构

```
src/
├── shared/            # 纯 TS，浏览器 / Bun / Worker 通用
│   ├── types.ts  format.ts（北京时间格式化）  province.ts（省份筛选与统计）
│   ├── timing.ts  predict.ts  stats.ts        # 耗时清洗模型、出分预测 + 回测（见 prediction.md）
│   ├── insights.ts                            # 学校统计、分数分布、分数线、快照 diff、实时动态
│   └── promotion.ts                           # 晋级形势（PR #1）
├── server/
│   ├── upstream.ts    # 上游抓取、归一化、排名、按 groupId 补全、TTL 缓存 + stale-while-error
│   ├── app.ts         # Hono API（两端共用）
│   ├── csv.ts  visits.ts
│   └── bun.ts         # 本地服务入口
├── worker/index.ts    # Cloudflare Worker 入口：BoardHub / BoardStats 两个 Durable Object
└── web/               # React 前端（index.html 为打包入口）
scripts/  build.ts  build-pages.ts  backtest.ts
tests/
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `HOST` | `8791` / `127.0.0.1` | 本地服务监听地址 |
| `CAMP_ID` | `21` | 训练营 id |
| `CACHE_TTL_MS` | `12000` | 上游结果缓存时长 |
| `UPSTREAM_TIMEOUT_MS` | `15000` | 单次上游请求超时（3 次退避重试） |
| `PUSH_INTERVAL_MS` | `15000` | 本地 WebSocket 推送间隔（≥ 5000） |
| `STATS_KEY` | 无 | 统计后台口令（也可放在项目根的 `.stats-key` 文件），见 [stats.md](stats.md) |
| `STATS_DB` | `.cache/stats.sqlite` | 本地统计数据库 |
| `HMR` | 关 | `HMR=1` 开启 Bun 前端热更新 |
| `LIVE_ORIGIN` | `https://board.nerv-base.com` | Pages 构建时注入的实时接口地址 |

> [!NOTE]
> HMR 默认关闭：Bun 1.4.4 的 HMR 运行时处理不了 `@tanstack/router-core` 内部的循环 import（`router.js ⇄ load-client.js`，报 `Cannot read properties of null (reading 'replaceRouteChunk')`）。不开 HMR 时改前端刷新页面即可。
