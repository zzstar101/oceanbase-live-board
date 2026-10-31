# 访问统计

全部自统计（Worker 用 `BoardStats` Durable Object，本地用 `bun:sqlite`），按北京时间切天，**不用第三方脚本、不写 cookie、不存原始 IP**：

- **PV / UV**：UV 按 `hash(日期 + IP + UA)` 去重，跨天不可关联，所以区间给「日 UV 之和」与「单日峰值」。
- **来源**（GitHub / 飞书 / 微信·QQ / 搜索引擎 / B 站 / 小红书 / 社交平台 / 直接访问）、**地区**（`request.cf.country`，本地为「本地」）、**设备**。
- **事件**：切换榜单、省份筛选、CSV 导出、外链点击、使用出分预测（每个赛道每次打开页面只记一次）、推荐位点击（按产品：seekdb / PowerContext / OceanBase）；当前在线 = 推送连接数。
- 在 localhost 打开的页面不打点。

## 开启

| 运行方式 | 怎么开 |
| --- | --- |
| Cloudflare Worker | `bunx wrangler secret put STATS_KEY` |
| 本地 / 自托管 | 环境变量 `STATS_KEY`，或在项目根放 `.stats-key` 文件（已 gitignore） |

没配置时 `/api/stats` 返回 503，打点直接丢弃。

## 后台

打开 `/stats`，输入 `STATS_KEY`（或直接用 `/stats?key=…` 打开，key 存进当前标签页并从地址栏移除）。可选 7 / 14 / 30 天，每 30 秒刷新：今日 PV / UV、当前在线、区间 PV、单日 UV 峰值、CSV 导出、出分预测次数、推荐位点击，每日 PV/UV 柱状图，以及榜单 / 省份 / 来源 / 地区 / 设备 / 推荐位排行。
