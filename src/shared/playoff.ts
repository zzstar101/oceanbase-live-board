// 加赛榜 → 初赛榜通用 Row 的映射。
//
// 加赛接口只给队名/分数，不带学校、省份、导师；这些字段从初赛快照按 groupId 补齐，
// 这样 /playoff 可以直接复用初赛榜的筛选、省份地图、学校统计、CSV 和队伍详情。
import { rowKey } from './insights.ts';
import type { Board, PlayoffBoardKey, PlayoffLeaderboard, PlayoffRow, Row } from './types.ts';

export interface PlayoffTeamMeta {
  school: string;
  advisor: string;
  province: string;
}

/**
 * 官方提测实际从 2026-11-09 12:00 开始。
 * playoff/entry 的 startsAt 目前返回 15:00（疑似评测/展示时间），
 * 页面上的状态、倒计时和赛程都以提测时间为准。
 */
export const PLAYOFF_SUBMISSION_START_AT = Date.parse('2026-11-09T12:00:00+08:00');

export function playoffStartsAt(entry: { startsAt: number } | null | undefined): number {
  const upstream = entry?.startsAt ?? 0;
  return upstream > 0 ? Math.min(upstream, PLAYOFF_SUBMISSION_START_AT) : PLAYOFF_SUBMISSION_START_AT;
}

/** 官方榜单里的名次字段；缺失时由行号兜底（1-based） */
export function playoffRank(r: PlayoffRow, board: PlayoffBoardKey): number | null {
  if (board === 'combined') return r.combinedRank;
  if (board === 'performance') return r.performanceRank;
  return r.promptRank;
}

/** 当前榜的排序/展示分：总榜看总分，性能榜看性能指标 E，Prompt 榜看原始分 */
export function playoffScore(r: PlayoffRow, board: PlayoffBoardKey): number | null {
  if (board === 'combined') return r.totalScore ?? r.playoffScore;
  if (board === 'performance') return r.performance;
  return r.promptRawScore;
}

/** 加赛行 → 初赛榜 Row（供 LeaderTable / 筛选 / 地图 / CSV 复用） */
export function playoffRowToRow(
  r: PlayoffRow,
  board: PlayoffBoardKey,
  index: number,
  meta?: PlayoffTeamMeta | null,
): Row {
  const score = playoffScore(r, board);
  return {
    rank: playoffRank(r, board) ?? index + 1,
    name: r.groupName,
    school: meta?.school ?? '',
    advisor: meta?.advisor ?? '',
    province: meta?.province ?? '',
    score,
    rawScore: score == null ? null : Math.round(score * 1000),
    bestSubmit: null,
    updated: r.submittedAt == null ? null : new Date(r.submittedAt).toISOString(),
    userId: null,
    groupId: r.groupId,
    recordId: null,
  };
}

/** 加赛耗时模型专用映射：提交与成绩完成时间分离，保留现有页面的 Row 映射。 */
export function playoffRowToTimingRow(
  r: PlayoffRow,
  board: PlayoffBoardKey,
  index: number,
  meta?: PlayoffTeamMeta | null,
): Row {
  return {
    ...playoffRowToRow(r, board, index, meta),
    bestSubmit: r.submittedAt == null ? null : new Date(r.submittedAt).toISOString(),
    updated: r.evaluatedAt == null ? null : new Date(r.evaluatedAt).toISOString(),
  };
}

/** groupId → 初赛队伍资料。总榜优先；后面的榜只补空字段。 */
export function buildPlayoffTeamMeta(boards: Board[]): Map<number, PlayoffTeamMeta> {
  const out = new Map<number, PlayoffTeamMeta>();
  const ordered = boards.slice().sort((a, b) => Number(b.kind === 'total') - Number(a.kind === 'total'));
  for (const board of ordered) {
    for (const row of board.rows) {
      if (row.groupId == null) continue;
      const prev = out.get(row.groupId);
      out.set(row.groupId, {
        school: prev?.school || row.school,
        advisor: prev?.advisor || row.advisor,
        province: prev?.province || row.province,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 一题两子题：合并模型

/** 加赛排序维度：综合（总分）/ 性能 / Prompt。和官方三个 leaderboard 的 key 一致。 */
export type PlayoffSort = PlayoffBoardKey;

/**
 * 一支队伍在加赛页上的一行。
 * combined / performance / prompt 三个接口按 groupId 合并，所有子题字段同屏展示；
 * 只在一个子榜出现的队伍也保留，缺失字段为 null。
 */
export interface PlayoffTeamRow {
  key: string;
  groupId: number | null;
  name: string;
  school: string;
  advisor: string;
  province: string;
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
  /** 成绩提交时间（毫秒） */
  submittedAt: number | null;
  /** 上游成绩完成/更新时间（毫秒）；没有就为 null */
  evaluatedAt: number | null;
}

export function playoffTeamKey(r: Pick<PlayoffTeamRow, 'groupId' | 'name'>): string {
  return r.groupId != null ? `g${r.groupId}` : `n${r.name}`;
}

const emptyTeam = (r: PlayoffRow, meta?: PlayoffTeamMeta | null): PlayoffTeamRow => ({
  key: playoffTeamKey({ groupId: r.groupId, name: r.groupName }),
  groupId: r.groupId,
  name: r.groupName,
  school: meta?.school ?? '',
  advisor: meta?.advisor ?? '',
  province: meta?.province ?? '',
  performance: r.performance,
  performancePoints: r.performancePoints,
  performanceRank: r.performanceRank,
  promptRawScore: r.promptRawScore,
  promptPoints: r.promptPoints,
  promptRank: r.promptRank,
  combinedRank: r.combinedRank,
  playoffScore: r.playoffScore,
  preliminaryScore: r.preliminaryScore,
  totalScore: r.totalScore,
  submittedAt: r.submittedAt,
  evaluatedAt: r.evaluatedAt ?? null,
});

/** 把同一个 groupId 的三榜行补齐；后到的榜只填空字段。 */
function fillTeam(t: PlayoffTeamRow, r: PlayoffRow) {
  t.name ||= r.groupName;
  t.performance ??= r.performance;
  t.performancePoints ??= r.performancePoints;
  t.performanceRank ??= r.performanceRank;
  t.promptRawScore ??= r.promptRawScore;
  t.promptPoints ??= r.promptPoints;
  t.promptRank ??= r.promptRank;
  t.combinedRank ??= r.combinedRank;
  t.playoffScore ??= r.playoffScore;
  t.preliminaryScore ??= r.preliminaryScore;
  t.totalScore ??= r.totalScore;
  if (r.submittedAt != null && (t.submittedAt == null || r.submittedAt < t.submittedAt)) t.submittedAt = r.submittedAt;
  if (r.evaluatedAt != null && (t.evaluatedAt == null || r.evaluatedAt > t.evaluatedAt)) t.evaluatedAt = r.evaluatedAt;
}

/**
 * 三榜合并。combined 先入，performance/prompt 补空；只出现在子榜的队伍也会保留。
 * meta 用初赛快照按 groupId 补学校/省份/导师。
 */
export function mergePlayoffTeams(
  boards: Partial<Record<PlayoffBoardKey, PlayoffLeaderboard>>,
  meta?: Map<number, PlayoffTeamMeta> | null,
): PlayoffTeamRow[] {
  const out = new Map<string, PlayoffTeamRow>();
  for (const board of ['combined', 'performance', 'prompt'] as const) {
    for (const row of boards[board]?.rows ?? []) {
      const key = playoffTeamKey({ groupId: row.groupId, name: row.groupName });
      const prev = out.get(key);
      if (prev) {
        fillTeam(prev, row);
      } else {
        out.set(key, emptyTeam(row, row.groupId != null ? meta?.get(row.groupId) : null));
      }
    }
  }
  for (const t of out.values()) {
    const m = t.groupId != null ? meta?.get(t.groupId) : null;
    if (m) {
      t.school ||= m.school;
      t.advisor ||= m.advisor;
      t.province ||= m.province;
    }
  }
  return Array.from(out.values());
}

export function playoffSortRank(r: PlayoffTeamRow, sort: PlayoffSort): number | null {
  if (sort === 'combined') return r.combinedRank;
  if (sort === 'performance') return r.performanceRank;
  return r.promptRank;
}

/** 当前排序维度的分数：综合用总分（初赛分 + 加赛综合分），性能用 E，Prompt 用原始分。 */
export function playoffSortScore(r: PlayoffTeamRow, sort: PlayoffSort): number | null {
  if (sort === 'combined') return r.totalScore;
  if (sort === 'performance') return r.performance;
  return r.promptRawScore;
}

/** 按官方名次排序；缺该维度成绩的队伍固定排最后，再按分数降序。 */
export function sortPlayoffTeams(rows: PlayoffTeamRow[], sort: PlayoffSort): PlayoffTeamRow[] {
  return rows.slice().sort((a, b) => {
    const ar = playoffSortRank(a, sort);
    const br = playoffSortRank(b, sort);
    if (sort === 'combined') {
      // 已出分的队伍按官方综合名次在前；尚未提测的初赛队伍按初赛总分排在后面。
      if (ar != null && br != null) {
        return ar - br || (playoffSortScore(b, sort) ?? -Infinity) - (playoffSortScore(a, sort) ?? -Infinity) || a.name.localeCompare(b.name, 'zh-CN');
      }
      if (ar != null) return -1;
      if (br != null) return 1;
      return (playoffSortScore(b, sort) ?? -Infinity) - (playoffSortScore(a, sort) ?? -Infinity) || a.name.localeCompare(b.name, 'zh-CN');
    }
    if (ar == null && br == null) {
      return (playoffSortScore(b, sort) ?? -Infinity) - (playoffSortScore(a, sort) ?? -Infinity) || a.name.localeCompare(b.name, 'zh-CN');
    }
    if (ar == null) return 1;
    if (br == null) return -1;
    return ar - br || (playoffSortScore(b, sort) ?? -Infinity) - (playoffSortScore(a, sort) ?? -Infinity) || a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function searchPlayoffTeams(rows: PlayoffTeamRow[], q: string | undefined): PlayoffTeamRow[] {
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = `${r.name}\n${r.school}\n${r.advisor}\n${r.province}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** 合并行 → 初赛 Row，仅供省份/学校/地图/关注等复用组件读取。 */
export function playoffTeamToRow(t: PlayoffTeamRow, index = 0): Row {
  const score = t.totalScore;
  return {
    rank: t.combinedRank ?? index + 1,
    name: t.name,
    school: t.school,
    advisor: t.advisor,
    province: t.province,
    score,
    rawScore: score == null ? null : Math.round(score * 1000),
    bestSubmit: t.submittedAt == null ? null : new Date(t.submittedAt).toISOString(),
    updated: t.evaluatedAt == null ? null : new Date(t.evaluatedAt).toISOString(),
    userId: null,
    groupId: t.groupId,
    recordId: null,
  };
}

/** 关注组件只认 Row；用合并行构造一个稳定 key（groupId 优先）。 */
export function playoffTeamStarRow(t: PlayoffTeamRow): Row {
  return playoffTeamToRow(t);
}

/** 初赛总榜前 50 名直接晋级决赛，不参加加赛；返回这些队伍在合并模型里的 key。 */
export function playoffTop50Keys(boards: Board[] | null | undefined): Set<string> {
  const keys = new Set<string>();
  const total = boards?.find((b) => b.kind === 'total');
  // 上游没有官方名次字段，页面 rank 由分数并列生成；英雄榜前 50 取上游顺序的前 50 条。
  // 不能用 rank <= 50：同一分数可能有很多并列队伍（实际有 250 支并列第 1）。
  for (const row of (total?.rows ?? []).slice(0, 50)) keys.add(rowKey(row));
  return keys;
}

/** 把初赛总榜第 51 名起的队伍并入加赛总榜；无加赛成绩时总分先按初赛分显示。 */
export function mergeInitialPlayoffTeams(
  teams: PlayoffTeamRow[],
  boards: Board[] | null | undefined,
): PlayoffTeamRow[] {
  const total = boards?.find((b) => b.kind === 'total');
  if (!total) return teams;
  const top50 = playoffTop50Keys(boards);
  const out = new Map(teams.map((t) => [t.key, t]));
  for (const row of total.rows) {
    const key = rowKey(row);
    if (top50.has(key)) continue;
    const prev = out.get(key);
    if (prev) {
      prev.school ||= row.school;
      prev.advisor ||= row.advisor;
      prev.province ||= row.province;
      prev.name ||= row.name;
      if (prev.preliminaryScore == null) prev.preliminaryScore = row.score;
      if (prev.totalScore == null && prev.preliminaryScore != null) {
        prev.totalScore = prev.preliminaryScore + (prev.playoffScore ?? 0);
      }
      continue;
    }
    out.set(key, {
      key,
      groupId: row.groupId,
      name: row.name,
      school: row.school,
      advisor: row.advisor,
      province: row.province,
      performance: null,
      performancePoints: null,
      performanceRank: null,
      promptRawScore: null,
      promptPoints: null,
      promptRank: null,
      combinedRank: null,
      playoffScore: null,
      preliminaryScore: row.score,
      totalScore: row.score,
      submittedAt: null,
      evaluatedAt: null,
    });
  }
  return Array.from(out.values());
}

/** 从加赛合并行中剔除初赛前 50 名。 */
export function excludePlayoffTop50(teams: PlayoffTeamRow[], boards: Board[] | null | undefined): PlayoffTeamRow[] {
  const keys = playoffTop50Keys(boards);
  return keys.size ? teams.filter((t) => !keys.has(t.key)) : teams;
}
