// 榜单 → CSV（本地服务、Worker 共用；旧实现复制了 3 份且漏了省份列、没转义 \r）
import type { PlayoffTeamRow } from '../shared/playoff.ts';
import { NO_PROVINCE } from '../shared/province.ts';
import type { Board, Row } from '../shared/types.ts';

export const CSV_HEAD = [
  'rank',
  'name',
  'school',
  'advisor',
  'province',
  'score',
  'rawScore',
  'bestSubmitTime',
  'lastUpdated',
  'userId',
  'groupId',
  'recordId',
] as const;

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 文本字段防 Excel 公式注入（=, +, -, @ 开头的单元格会被当成公式执行） */
const text = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function rowsToCsv(rows: Row[]): string {
  const lines = [CSV_HEAD.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.rank,
        text(r.name),
        text(r.school),
        text(r.advisor),
        text(r.province),
        r.score,
        r.rawScore,
        r.bestSubmit,
        r.updated,
        r.userId,
        r.groupId,
        r.recordId,
      ]
        .map(esc)
        .join(','),
    );
  }
  // BOM 让 Excel 正确识别 UTF-8；CRLF 是 RFC 4180 的行尾
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

export const PLAYOFF_CSV_HEAD = [
  'combinedRank',
  'team',
  'school',
  'advisor',
  'province',
  'performance',
  'performanceRank',
  'performancePoints',
  'promptRawScore',
  'promptRank',
  'promptPoints',
  'playoffScore',
  'preliminaryScore',
  'totalScore',
  'submittedAt',
  'evaluatedAt',
  'groupId',
] as const;

/** 加赛合并 CSV：一支队伍一行，同时带两个子题的全部字段。 */
export function playoffTeamsToCsv(rows: PlayoffTeamRow[]): string {
  const lines = [PLAYOFF_CSV_HEAD.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.combinedRank,
        text(r.name),
        text(r.school),
        text(r.advisor),
        text(r.province),
        r.performance,
        r.performanceRank,
        r.performancePoints,
        r.promptRawScore,
        r.promptRank,
        r.promptPoints,
        r.playoffScore,
        r.preliminaryScore,
        r.totalScore,
        r.submittedAt == null ? '' : new Date(r.submittedAt).toISOString(),
        r.evaluatedAt == null ? '' : new Date(r.evaluatedAt).toISOString(),
        r.groupId,
      ]
        .map(esc)
        .join(','),
    );
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

export function csvFilename(board: Board, province?: string | null) {
  const p = province ? `-${province === NO_PROVINCE ? '未填省份' : province}` : '';
  return `oceanbase-${board.id}${p}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/** RFC 5987 Content-Disposition（文件名含中文） */
export const contentDisposition = (filename: string) =>
  `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
