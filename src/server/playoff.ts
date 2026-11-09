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
const PAGE_SIZE = 100;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 上游 submittedAt 可能是毫秒数、数字字符串或 ISO 字符串 */
const ts = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : null;
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
    startsAt: ts(rec?.startsAt) ?? 0,
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
    pageSize: num(rec?.pageSize) ?? PAGE_SIZE,
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

export async function fetchPlayoffLeaderboard(questionId: number | string, board: PlayoffBoardKey): Promise<PlayoffLeaderboard> {
  const data = await getJson('/testplatform/playoff/leaderboard', {
    questionId,
    board,
    pageNo: 1,
    pageSize: PAGE_SIZE,
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

const emptyLeaderboard = (board: PlayoffBoardKey, error: string | null, stale = false): PlayoffLeaderboard => ({
  board,
  provisional: true,
  activityCode: null,
  resultSequence: null,
  total: 0,
  pageNo: 1,
  pageSize: PAGE_SIZE,
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
  { force = false } = {},
): Promise<PlayoffLeaderboard> {
  try {
    const c = await cached(
      `playoff:board:${questionId}:${board}`,
      () => fetchPlayoffLeaderboard(questionId, board),
      force ? 0 : getConfig().ttlMs,
    );
    return { ...c.value, error: c.error, stale: c.stale, at: c.at };
  } catch (err) {
    return emptyLeaderboard(board, errMsg(err));
  }
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
