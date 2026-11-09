// 加赛（playoff）数据源：入口、三个榜单、提测配置、题目介绍。
//
// 与初赛赛道不同，加赛题（600081）没有走 queryTestPlatformScoreList：
// 该接口对 600081 返回 500「提测一级题目未创建」，加赛有独立的 playoff/* 接口。
//
// 公开接口（免登录，2026-11-09 验证）：
//   入口      GET /testplatform/playoff/entry?campId=21
//   榜单      GET /testplatform/playoff/leaderboard?questionId=600081&board=combined|performance|prompt&pageNo=1&pageSize=100
//   提测配置  GET /testplatform/taskrecord/submissionOptions?questionId=600081
//   题目介绍  GET /testplatform/question/webQueryTestPlatformQuestionList?rpcFromType=0&campId=21&pageSize=200&pageNo=1
//
// 踩过的坑：
//   * combined 榜用 pageSize=20 会间歇性 500「加赛榜分页参数无效」，pageSize=100 稳定；
//     带 rankLimit 也会触发同样的错误，所以这里统一 pageSize=100、不带 rankLimit。
//   * participation 接口需要登录 cookie（401），公开站点拿不到「我的提测记录」。
import { playoffStartsAt } from '../shared/playoff.ts';
import type {
  PlayoffBoardKey,
  PlayoffEntry,
  PlayoffFormField,
  PlayoffInfo,
  PlayoffLeaderboard,
  PlayoffQuestion,
  PlayoffRow,
  PlayoffSubmission,
} from '../shared/types.ts';
import { cached, errMsg, getConfig, getJson } from './upstream.ts';

const BOARD_KEYS: PlayoffBoardKey[] = ['combined', 'performance', 'prompt'];
/** 官方页面 pageSize=20，但 combined 在 20 时不稳定；100 足够装下任何一榜的前 100 名 */
export const PLAYOFF_PAGE_SIZE = 100;
/** 加赛榜短缓存：页面 30 秒轮询，缓存 30 秒，避免开赛后每个页面每 15 秒直接打上游。 */
const PLAYOFF_TTL_MS = 30_000;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 上游时间为正毫秒数、数字字符串或明确时区的 ISO 字符串，不转换秒时间戳。 */
const ts = (v: unknown): number | null => {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const text = typeof v === 'string' ? v.trim() : null;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (text && /^\d+(?:\.\d+)?$/.test(text)) n = Number(text);
  else if (text && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) n = Date.parse(text);
  else return null;
  return Number.isFinite(n) && n > 0 && n <= 8.64e15 ? n : null;
};

export function normalizePlayoffRow(rec: any): PlayoffRow {
  return {
    groupId: num(rec?.groupId),
    groupName: str(rec?.groupName) || (rec?.groupId != null ? `队伍 #${rec.groupId}` : '—'),
    performance: num(rec?.performance),
    performancePoints: num(rec?.performancePoints),
    performanceRank: num(rec?.performanceRank),
    promptRawScore: num(rec?.promptRawScore),
    promptPoints: num(rec?.promptPoints),
    promptRank: num(rec?.promptRank),
    combinedRank: num(rec?.combinedRank),
    playoffScore: num(rec?.playoffScore),
    preliminaryScore: num(rec?.preliminaryScore),
    totalScore: num(rec?.totalScore),
    submittedAt: ts(rec?.submittedAt),
    // 成绩记录的完成时间独立于提交时间；不使用榜单抓取时间补齐。
    evaluatedAt: ts(rec?.evaluatedAt) ?? ts(rec?.completedAt) ?? ts(rec?.updatedAt),
  };
}

const formFields = (v: unknown): PlayoffFormField[] =>
  Array.isArray(v) ? v.filter((x): x is PlayoffFormField => Boolean(x) && typeof x === 'object') : [];

export function normalizePlayoffSubmission(rec: any): PlayoffSubmission {
  return {
    managed: Boolean(rec?.managed),
    submissionType: str(rec?.submissionType),
    evaluationMode: str(rec?.evaluationMode),
    resultFormat: str(rec?.resultFormat),
    maxScore: num(rec?.maxScore),
    repoSlot: str(rec?.repoSlot),
    available: Boolean(rec?.available),
    requiredFields: formFields(rec?.requiredFields),
    extraFields: formFields(rec?.extraFields),
    campId: num(rec?.campId),
    questionId: num(rec?.questionId),
  };
}

export function normalizePlayoffEntry(rec: any): PlayoffEntry {
  return {
    campId: Number(rec?.campId ?? getConfig().campId),
    questionId: Number(rec?.questionId ?? 0),
    questionName: str(rec?.questionName) || '加赛题',
    startsAt: playoffStartsAt({ startsAt: ts(rec?.startsAt) ?? 0 }),
    endsAt: ts(rec?.endsAt) ?? 0,
    phase: str(rec?.phase) || 'UNKNOWN',
  };
}

export function normalizePlayoffLeaderboard(board: PlayoffBoardKey, rec: any): PlayoffLeaderboard {
  const rows = Array.isArray(rec?.rows) ? rec.rows.map(normalizePlayoffRow) : [];
  return {
    board,
    provisional: Boolean(rec?.provisional),
    activityCode: num(rec?.activityCode),
    resultSequence: num(rec?.resultSequence),
    total: num(rec?.total) ?? rows.length,
    pageNo: num(rec?.pageNo) ?? 1,
    pageSize: num(rec?.pageSize) ?? PLAYOFF_PAGE_SIZE,
    rows,
    performanceTop: Array.isArray(rec?.performanceTop) ? rec.performanceTop.map(normalizePlayoffRow) : [],
    promptTop: Array.isArray(rec?.promptTop) ? rec.promptTop.map(normalizePlayoffRow) : [],
    error: null,
    stale: false,
    at: Date.now(),
  };
}

export const isPlayoffBoardKey = (v: unknown): v is PlayoffBoardKey =>
  typeof v === 'string' && (BOARD_KEYS as string[]).includes(v);

// ---------------------------------------------------------------- upstream

export async function fetchPlayoffEntry(campId = getConfig().campId): Promise<PlayoffEntry> {
  return normalizePlayoffEntry(await getJson('/testplatform/playoff/entry', { campId }));
}

export async function fetchPlayoffLeaderboard(
  questionId: number | string,
  board: PlayoffBoardKey,
  pageNo = 1,
  pageSize = PLAYOFF_PAGE_SIZE,
): Promise<PlayoffLeaderboard> {
  const data = await getJson('/testplatform/playoff/leaderboard', {
    questionId,
    board,
    pageNo,
    pageSize,
  });
  return normalizePlayoffLeaderboard(board, data);
}

export async function fetchPlayoffSubmission(questionId: number | string): Promise<PlayoffSubmission> {
  return normalizePlayoffSubmission(await getJson('/testplatform/taskrecord/submissionOptions', { questionId }));
}

/** 加赛题不在普通题目列表里（截至开赛前）；开赛后若出现，就顺带取官方题目介绍 */
export async function fetchPlayoffQuestion(questionId: number | string): Promise<PlayoffQuestion | null> {
  const data = await getJson('/testplatform/question/webQueryTestPlatformQuestionList', {
    rpcFromType: 0,
    campId: getConfig().campId,
    pageSize: 200,
    pageNo: 1,
  });
  const hit = (Array.isArray(data?.list) ? data.list : []).find((q: any) => Number(q?.id) === Number(questionId));
  if (!hit) return null;
  return {
    id: Number(hit.id),
    name: str(hit.questionName) || `题目 ${hit.id}`,
    introduce: typeof hit.introduce === 'string' && hit.introduce.trim() ? hit.introduce : null,
  };
}

// ---------------------------------------------------------------- cached getters

export const getPlayoffEntry = ({ force = false } = {}) =>
  cached('playoff:entry', () => fetchPlayoffEntry(), force ? 0 : 60_000);

export const getPlayoffSubmission = (questionId: number | string, { force = false } = {}) =>
  cached(`playoff:submission:${questionId}`, () => fetchPlayoffSubmission(questionId), force ? 0 : 60_000);

export const getPlayoffQuestion = (questionId: number | string, { force = false } = {}) =>
  cached(`playoff:question:${questionId}`, () => fetchPlayoffQuestion(questionId), force ? 0 : 60_000);

const emptyLeaderboard = (
  board: PlayoffBoardKey,
  error: string | null,
  pageNo = 1,
  pageSize = PLAYOFF_PAGE_SIZE,
  stale = false,
): PlayoffLeaderboard => ({
  board,
  provisional: true,
  activityCode: null,
  resultSequence: null,
  total: 0,
  pageNo,
  pageSize,
  rows: [],
  performanceTop: [],
  promptTop: [],
  error,
  stale,
  at: 0,
});

export async function getPlayoffLeaderboard(
  questionId: number | string,
  board: PlayoffBoardKey,
  { force = false, pageNo = 1, pageSize = PLAYOFF_PAGE_SIZE } = {},
): Promise<PlayoffLeaderboard> {
  try {
    const c = await cached(
      `playoff:board:${questionId}:${board}:${pageNo}:${pageSize}`,
      () => fetchPlayoffLeaderboard(questionId, board, pageNo, pageSize),
      force ? 0 : PLAYOFF_TTL_MS,
    );
    return { ...c.value, error: c.error, stale: c.stale, at: c.at };
  } catch (err) {
    return emptyLeaderboard(board, errMsg(err), pageNo, pageSize);
  }
}

/**
 * CSV 全量导出用：按 total 拉完一个榜的所有分页。
 * 任何一页失败都抛错，避免用户下载到“看起来完整、其实缺页”的 CSV。
 */
export async function fetchAllPlayoffRows(
  questionId: number | string,
  board: PlayoffBoardKey,
  { force = false } = {},
): Promise<PlayoffLeaderboard> {
  const first = await getPlayoffLeaderboard(questionId, board, { force, pageNo: 1 });
  if (first.error) throw new Error(first.error);
  const pageSize = first.pageSize || PLAYOFF_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(first.total / pageSize));
  if (pageCount > 50) throw new Error(`榜单分页过多（${pageCount} 页），请稍后重试`);
  const rows = [...first.rows];
  for (let pageNo = 2; pageNo <= pageCount; pageNo++) {
    const next = await getPlayoffLeaderboard(questionId, board, { force, pageNo, pageSize });
    if (next.error) throw new Error(next.error);
    rows.push(...next.rows);
  }
  return { ...first, rows, total: first.total, pageSize };
}

/** 加赛页首屏：入口 + 提测配置 + 题目介绍。任何一块失败都不影响其它块。 */
export async function getPlayoffInfo({ force = false } = {}): Promise<PlayoffInfo> {
  let entry: PlayoffEntry | null = null;
  let entryError: string | null = null;
  try {
    const c = await getPlayoffEntry({ force });
    entry = c.value;
    entryError = c.error;
  } catch (err) {
    entryError = errMsg(err);
  }

  if (!entry) {
    return {
      entry: null,
      submission: null,
      question: null,
      error: entryError,
      entryError,
      submissionError: null,
      generatedAt: new Date().toISOString(),
    };
  }

  const [subC, questionC] = await Promise.all([
    getPlayoffSubmission(entry.questionId, { force }).catch((err) => ({ value: null, error: errMsg(err) })),
    getPlayoffQuestion(entry.questionId, { force }).catch((err) => ({ value: null, error: errMsg(err) })),
  ]);

  return {
    entry,
    submission: subC.value,
    question: questionC.value,
    error: entryError,
    entryError,
    submissionError: subC.value ? null : (subC.error ?? null),
    generatedAt: new Date().toISOString(),
  };
}
