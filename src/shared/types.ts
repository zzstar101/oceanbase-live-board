// 全项目共享的数据契约：上游归一化 → 服务端 / Worker → 前端 / 分析模块。

/** 榜单上的一行（总榜 = 一支队伍；赛道榜 = 该队伍在这个赛道的最优记录） */
export interface Row {
  /** 本看板按成绩重算的名次（同分并列，竞赛排名 1,1,3…） */
  rank: number;
  name: string;
  school: string;
  advisor: string;
  /** 省份全称（如「四川省」）；上游缺失且无法从总榜补齐时为空串 */
  province: string;
  /** 页面显示成绩（webTotalScore） */
  score: number | null;
  /** 原始整数成绩（totalScore，= score × 1000） */
  rawScore: number | null;
  /**
   * gmtCreate（UTC ISO）。
   * 赛道榜：该队「最优那次提交」的提测时刻（分数提升时随之变化，实测 2026-10-29→30 两份快照完全一致）。
   * 总榜：聚合记录的创建时刻。
   */
  bestSubmit: string | null;
  /**
   * gmtModified（UTC ISO）。
   * 赛道榜：最优那次提交的出分（写库）时刻 —— 与 bestSubmit 的差就是这次提交的端到端耗时。
   * 总榜：聚合记录最后一次更新。
   */
  updated: string | null;
  userId: string | null;
  /** 队伍 id：总榜与赛道榜之间唯一可靠的关联键（userId 只是某个提交成员，关联率仅 ~65%） */
  groupId: number | null;
  recordId: number | null;
}

export type BoardKind = 'total' | 'track';

export interface Board {
  /** 'total' 或 'q<questionId>' */
  id: string;
  title: string;
  kind: BoardKind;
  questionId: number | null;
  rows: Row[];
  /** 上游抓取失败的错误信息（此时 rows 可能是最后一次成功的数据，见 stale） */
  error: string | null;
  /** true = 上游抖动，rows 是最后一次成功的数据 */
  stale: boolean;
  /** 与 rows 原子取得的最后一次成功缓存时间；0 或缺失表示未知，不能用 generatedAt 替代。 */
  fetchedAt?: number;
  /** 上游报告的总数（总榜可信；赛道榜只是本次返回条数） */
  reportedTotal: number | null;
  /** 源站页面 */
  source: string;
}

export interface StaticBuildInfo {
  builtAt: string;
  builtBy: string;
  fetchMs: number;
  brokenBoards: { id: string; title: string; error: string | null }[];
}

export interface Snapshot {
  campId: number;
  /** 本快照生成时刻（UTC ISO） */
  generatedAt: string;
  /** boards[0] 恒为总榜，其余赛道按参与人数降序 */
  boards: Board[];
  /** 仅 GitHub Pages 构建产物带 */
  static?: StaticBuildInfo;
  /** 由推送中枢（Worker Durable Object / Bun WebSocket）下发时带 */
  push?: PushInfo;
}

export interface PushInfo {
  intervalMs: number;
  clients: number;
}

/** /api/online */
export interface OnlineInfo {
  sockets: number;
  lastPush: number | null;
  intervalMs: number;
}

/** /api/health */
export interface HealthInfo {
  ok: true;
  campId: number;
  cacheTtlMs: number;
  at: string;
  runtime: 'bun' | 'cloudflare-worker';
  push: { intervalMs: number } | null;
  stats: boolean;
}

/** 前端打点事件（/api/hit，sendBeacon text/plain） */
export type HitKind = 'pv' | 'board' | 'csv' | 'out' | 'predict' | 'province' | 'ad';
export interface HitEvent {
  k: HitKind;
  /** 榜单 id / 省份名 / 推广位 id 等 */
  t?: string;
  /** document.referrer（仅 pv） */
  r?: string;
}

export interface StatsDay {
  day: string;
  pv: number;
  uv: number;
  csv: number;
  out: number;
  pred: number;
  prov: number;
  ad: number;
}

export interface NamedCount {
  name: string;
  count: number;
}

/** /api/stats */
export interface StatsSummary {
  ok: true;
  days: number;
  today: StatsDay;
  series: StatsDay[];
  totals: {
    pv: number;
    /** 区间内日 UV 之和（访客哈希按天加盐，跨天无法去重） */
    uvDaySum: number;
    /** 区间内单日 UV 峰值 */
    uvPeak: number;
    csv: number;
    out: number;
    pred: number;
    prov: number;
    /** 推广位点击 */
    ad: number;
  };
  boards: NamedCount[];
  todayBoards: NamedCount[];
  provinces: NamedCount[];
  refs: NamedCount[];
  geo: NamedCount[];
  dev: NamedCount[];
  /** 推广位点击，按产品 */
  ads: NamedCount[];
  online: number;
}

// ---------------------------------------------------------------- 加赛（playoff）

export type PlayoffBoardKey = 'combined' | 'performance' | 'prompt';

/** 加赛入口信息。phase 由上游给出，前端再用 startsAt/endsAt 兜底推算。 */
export interface PlayoffEntry {
  campId: number;
  questionId: number;
  questionName: string;
  /** 开赛时刻（毫秒时间戳，北京时间 2026-11-09 12:00） */
  startsAt: number;
  /** 结束时刻（毫秒时间戳） */
  endsAt: number;
  phase: string;
}

/** 加赛榜一行（三个榜共用一个结构，用不到的字段为 null） */
export interface PlayoffRow {
  groupId: number | null;
  groupName: string;
  /** 性能指标 E，官方保留 6 位小数 */
  performance: number | null;
  performancePoints: number | null;
  performanceRank: number | null;
  promptRawScore: number | null;
  promptPoints: number | null;
  promptRank: number | null;
  combinedRank: number | null;
  playoffScore: number | null;
  preliminaryScore: number | null;
  totalScore: number | null;
  /** 成绩提交日（毫秒时间戳；上游可能给毫秒数或 ISO 字符串） */
  submittedAt: number | null;
  /** 上游成绩完成/更新时间（evaluatedAt、completedAt 或 updatedAt）；缺失时无出分样本。 */
  evaluatedAt?: number | null;
}

export interface PlayoffLeaderboard {
  board: PlayoffBoardKey;
  /** true = 官方标注的「暂定榜单」 */
  provisional: boolean;
  activityCode: number | null;
  resultSequence: number | null;
  total: number;
  pageNo: number;
  pageSize: number;
  rows: PlayoffRow[];
  performanceTop: PlayoffRow[];
  promptTop: PlayoffRow[];
  /** 抓取失败时的错误（rows 可能是上一次成功数据） */
  error: string | null;
  stale: boolean;
  /** 本次数据抓取时刻（毫秒） */
  at: number;
}

/** 提测表单字段（上游结构未定，保留原始键值；页面只展示 label/name） */
export interface PlayoffFormField {
  key?: string;
  name?: string;
  label?: string;
  type?: string;
  required?: boolean;
  [k: string]: unknown;
}

/** /taskrecord/submissionOptions 的归一化结果 */
export interface PlayoffSubmission {
  managed: boolean;
  submissionType: string;
  evaluationMode: string;
  resultFormat: string;
  maxScore: number | null;
  /** 代码仓库地址对应的表单槽位，如 gitUrlPlus */
  repoSlot: string;
  available: boolean;
  requiredFields: PlayoffFormField[];
  extraFields: PlayoffFormField[];
  campId: number | null;
  questionId: number | null;
}

/** 加赛题目介绍（题目未公开时 question 为 null） */
export interface PlayoffQuestion {
  id: number;
  name: string;
  /** 官方题目介绍 HTML */
  introduce: string | null;
}

/** GET /api/playoff：入口 + 提测配置 + 题目介绍 */
export interface PlayoffInfo {
  entry: PlayoffEntry | null;
  submission: PlayoffSubmission | null;
  question: PlayoffQuestion | null;
  /** 整体错误（entry 失败时） */
  error: string | null;
  entryError: string | null;
  submissionError: string | null;
  generatedAt: string;
}

/** 一条「提交 → 出分」样本（毫秒时间戳），由赛道榜行转换而来 */
export interface Sample {
  /** 提测时刻（bestSubmit） */
  t: number;
  /** 出分时刻（updated） */
  done: number;
  name: string;
  groupId: number | null;
}

/** 把赛道榜行转换成有效样本（done > t），按提交时刻升序 */
export function samplesOf(rows: Row[]): Sample[] {
  const out: Sample[] = [];
  for (const r of rows) {
    const t = r.bestSubmit ? Date.parse(r.bestSubmit) : Number.NaN;
    const done = r.updated ? Date.parse(r.updated) : Number.NaN;
    if (!Number.isFinite(t) || !Number.isFinite(done) || done <= t) continue;
    out.push({ t, done, name: r.name, groupId: r.groupId });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
