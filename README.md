<div align="center">

<img src="docs/logo.svg" width="96" height="96" alt="logo" />

# OceanBase 榜单实时看板

**数据库大赛总榜 · seekdb AI 训练营 11 个赛道 —— 全量名单、按省份筛选、出分预测，一页看清**

[![在线看板](https://img.shields.io/badge/在线看板-GitHub_Pages-1f6fff?style=flat-square&logo=github)](https://zzstar101.github.io/oceanbase-live-board/)
[![实时直连](https://img.shields.io/badge/实时直连-board.nerv--base.com-f38020?style=flat-square&logo=cloudflare&logoColor=white)](https://board.nerv-base.com/)
[![Pages](https://img.shields.io/github/actions/workflow/status/zzstar101/oceanbase-live-board/pages.yml?style=flat-square&label=快照构建)](https://github.com/zzstar101/oceanbase-live-board/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
<br />
[![seekdb](https://img.shields.io/badge/seekdb-AI_原生搜索数据库-0ea5e9?style=flat-square)](https://www.seekdb.ai/)
[![PowerContext](https://img.shields.io/badge/PowerContext-Agent_记忆-a855f7?style=flat-square)](https://powercontext.oceanbase.io/zh/)
[![OceanBase](https://img.shields.io/badge/OceanBase-分布式_·_AI_数据库-1f6fff?style=flat-square)](https://www.oceanbase.com/)

<br />

<img src="docs/screenshot-total.png" alt="总榜" width="100%" />

</div>

<br />

官方页面只显示 Top 10，这里是**全部队伍**。直接打开就能用，不用登录：

- **实时版** <https://board.nerv-base.com/> —— 有新成绩会自动推送到页面
- **备用版** <https://zzstar101.github.io/oceanbase-live-board/> —— 实时版连不上时自动退回每 10 分钟一次的快照（顶栏显示「静态快照」）

## 怎么用

| 想看什么 | 怎么做 |
| --- | --- |
| 某个赛道 | 点顶部的赛道标签，数字是参赛队伍数 |
| **只看某个省** | 用「省份」下拉框，或点右侧**省份地图**上的格子 / 「省份与学校」表里的省份。整页（榜单、指标、分布、动态、CSV）都会切换，名次旁边会多一个「省内名次」；再点一次取消 |
| 找队伍 / 学校 / 导师 | 搜索框，空格分隔多个关键词；在「省份与学校」里点学校名也会直接搜索 |
| 一支队伍的全部成绩 | 点榜单里的队名：总榜名次、各赛道成绩与满分、最优提交和耗时、现在提交大约何时出分 |
| **盯住自己的队** | 点行首的 ☆。关注的队伍会出现在页面顶部（总榜名次、各赛道名次与变化），在榜单里高亮。只存在你的浏览器里 |
| 交了多久能出分 | 选一个赛道 →「出分耗时与预测」，填提交时间，给出**预计出分时刻和 80% 区间**，下方写着这个赛道近 24 小时的实际预测误差 |
| 离前 10 / 50 / 100 还差多少 | 「分数分布」：每档分数线和达线人数，关注的队伍会显示离下一档差几分 |
| 晋级还剩几个名额 | 「晋级形势」：名额（可改）− 已满分队伍；列出只差一个赛道就满分的队伍，以及他们差的是「分不够 / 判了 0 分 / 还没出分」 |
| 刚刚谁出分了 | 右侧「实时动态」，可选最近 1 / 6 / 24 小时、只看当前赛道或只看关注的队伍 |
| 导出 | 「CSV」按钮导出当前榜单（选了省份就只导该省），Excel 直接打开不乱码 |
| 分享 | 地址栏就是当前视图，直接复制，例如 `?board=q600080&province=四川省&tab=timing` |

> [!TIP]
> 页面跟随系统自动切换浅色 / 暗色，手机上也能用。数据来自官方公开接口，一般比官方页面晚不到半分钟。

> [!WARNING]
> 出分预测只能根据「已经出分的记录」反推，平台停摆（曾出现过 5–16 小时零出分）没法预测；遇到这种情况面板会直接写「无法预测」。原理和准确度见 [出分预测](docs/prediction.md)。

## 截图

| 按省份筛选 | 出分耗时与预测 |
| :---: | :---: |
| ![省份筛选](docs/screenshot-province.png) | ![出分预测](docs/screenshot-timing.png) |
| **队伍详情** | **分数分布与分数线** |
| ![队伍详情](docs/screenshot-team.png) | ![分数分布](docs/screenshot-dist.png) |
| **晋级形势** | **省份与学校（暗色）** |
| ![晋级形势](docs/screenshot-promo.png) | ![省份与学校](docs/screenshot-region-dark.png) |

## 比赛用到的产品

这次比赛的赛道就是围绕下面这几个产品出的题，顺手推荐一下：

<table>
<tr>
<td width="33%" valign="top">

**[seekdb](https://www.seekdb.ai/)** · AI 原生搜索数据库

向量、全文、结构化数据混合检索，一个引擎搞定，嵌入式即开即用，很适合给 Agent 当存储。

[官网](https://www.seekdb.ai/) · [GitHub](https://github.com/oceanbase/seekdb)

</td>
<td width="33%" valign="top">

**[PowerContext](https://powercontext.oceanbase.io/zh/)** · Agent 记忆

给 Claude Code / Codex 的长期记忆与上下文交接：换个新会话，决策、约束和进度不用再交代一遍。

[官网](https://powercontext.oceanbase.io/zh/) · [GitHub](https://github.com/oceanbase/powercontext)

</td>
<td width="33%" valign="top">

**[OceanBase](https://www.oceanbase.com/)** · 分布式 · AI 数据库

完全自研的分布式数据库，高度兼容 MySQL / Oracle，一套系统承载交易、实时分析与 AI 负载。

[官网](https://www.oceanbase.com/) · [社区](https://open.oceanbase.com/)

</td>
</tr>
</table>

## 自己跑一个

```bash
bun install
bun run dev          # → http://127.0.0.1:8791
```

更多见文档：

| 文档 | 内容 |
| --- | --- |
| [本地开发](docs/development.md) | 命令、技术栈、目录结构、环境变量 |
| [部署](docs/deployment.md) | Cloudflare Worker、GitHub Pages、任意主机 |
| [接口](docs/api.md) | HTTP / WebSocket 接口，上游接口与踩过的坑 |
| [出分预测](docs/prediction.md) | 耗时清洗、预测算法与回测数据 |
| [访问统计](docs/stats.md) | 统计了什么、怎么开启、后台 `/stats` |
| [更新记录](CHANGELOG.md) | 版本变化与修掉的问题 |

## 致谢

「晋级形势」的想法与第一版实现来自 [@Nickchen-PUSH](https://github.com/Nickchen-PUSH)（[PR #1](https://github.com/zzstar101/oceanbase-live-board/pull/1)）。

<br />

<div align="center"><sub>以 <a href="LICENSE">MIT</a> 协议开源 · 数据来自 <a href="https://open.oceanbase.com/">open.oceanbase.com</a> 公开榜单接口，本项目与 OceanBase 官方无关。</sub></div>
