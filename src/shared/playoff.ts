// 加赛榜 → 初赛榜通用 Row 的映射。
//
// 加赛接口只给队名/分数，不带学校、省份、导师；这些字段从初赛快照按 groupId 补齐，
// 这样 /playoff 可以直接复用初赛榜的筛选、省份地图、学校统计、CSV 和队伍详情。
import type { Board, PlayoffBoardKey, PlayoffRow, Row } from './types.ts';

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
