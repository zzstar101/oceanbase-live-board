// 加赛：上游归一化、缓存兜底、Hono 路由
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApi } from '../src/server/app.ts';
import {
  buildPlayoffTeamMeta,
  excludePlayoffTop50,
  mergePlayoffTeams,
  playoffRowToRow,
  playoffRowToTimingRow,
  playoffStartsAt,
  playoffTop50Keys,
  searchPlayoffTeams,
  sortPlayoffTeams,
  type PlayoffTeamRow,
} from '../src/shared/playoff.ts';
import type { Board, PlayoffLeaderboard, PlayoffRow } from '../src/shared/types.ts';
import {
  getPlayoffInfo,
  getPlayoffLeaderboard,
  normalizePlayoffEntry,
  normalizePlayoffLeaderboard,
  normalizePlayoffRow,
  normalizePlayoffSubmission,
} from '../src/server/playoff.ts';
import { clearCache, setFetch, type FetchFn } from '../src/server/upstream.ts';

const upstream = {
  fail: false,
  entry: {
    campId: 21,
    questionId: 600081,
    questionName: '轻量向量数据库（MiniVectorDB）',
    startsAt: 1794196800000,
    endsAt: 1794974400000,
    phase: 'UPCOMING',
  },
  rows: [
    {
      combinedRank: 1,
      groupId: 7,
      groupName: '队A',
      performance: '123.456789',
      promptRawScore: '88.5',
      playoffScore: '70.25',
      preliminaryScore: 600,
      totalScore: '670.25',
      submittedAt: '2026-11-09T06:30:00.000+00:00',
    },
  ],
  submission: {
    managed: true,
    extraFields: [],
    requiredFields: [{ name: 'repoUrl', label: '代码仓库地址', required: true }],
    questionId: 600081,
    campId: 21,
    evaluationMode: 'STANDARD_PULL',
    submissionType: 'CODE',
    resultFormat: 'PLAYOFF',
    maxScore: '80',
    repoSlot: 'gitUrlPlus',
    available: true,
  },
  questions: [{ id: 600081, questionName: '轻量向量数据库（MiniVectorDB）', introduce: '<p>题目介绍</p>' }],
};

const mockFetch: FetchFn = async (input) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (upstream.fail) return new Response('down', { status: 502 });
  const ok = (data: unknown) => Response.json({ code: 200, data });
  if (url.pathname.endsWith('playoff/entry')) return ok(upstream.entry);
  if (url.pathname.endsWith('playoff/leaderboard')) {
    return ok({
      provisional: true,
      activityCode: 4924143,
      resultSequence: 1,
      board: url.searchParams.get('board'),
      total: upstream.rows.length,
      pageNo: 1,
      pageSize: 100,
      rows: upstream.rows,
      performanceTop: [],
      promptTop: [],
    });
  }
  if (url.pathname.endsWith('submissionOptions')) return ok(upstream.submission);
  if (url.pathname.endsWith('webQueryTestPlatformQuestionList')) return ok({ list: upstream.questions });
  return new Response('?', { status: 404 });
};

beforeEach(() => {
  clearCache();
  upstream.fail = false;
  setFetch(mockFetch);
});
afterEach(() => clearCache());

describe('normalizePlayoffRow', () => {
  test('数字字符串转 number，submittedAt 支持 ISO 字符串，缺队名时用 groupId 兜底', () => {
    expect(normalizePlayoffRow(upstream.rows[0])).toMatchObject({
      groupId: 7,
      groupName: '队A',
      performance: 123.456789,
      promptRawScore: 88.5,
      playoffScore: 70.25,
      totalScore: 670.25,
      submittedAt: Date.parse('2026-11-09T06:30:00.000+00:00'),
    });
    expect(normalizePlayoffRow({ groupId: 9 }).groupName).toBe('队伍 #9');
  });

  test('invalid completion times fall through to valid fields without producing invalid dates', () => {
    const done = Date.parse('2026-11-09T06:35:00Z');
    for (const invalid of [0, ' ', false, true, 1e20, -1, Infinity, 'invalid', '2026-11-09T06:35:00', '2026-99-99T06:35:00Z']) {
      const fallback = normalizePlayoffRow({ submittedAt: upstream.rows[0]!.submittedAt, evaluatedAt: invalid, completedAt: done });
      expect(fallback.evaluatedAt).toBe(done);
      const empty = normalizePlayoffRow({ submittedAt: invalid, evaluatedAt: invalid, completedAt: invalid, updatedAt: invalid });
      expect(empty.submittedAt).toBeNull();
      expect(empty.evaluatedAt).toBeNull();
      expect(() => playoffRowToRow(empty, 'combined', 0)).not.toThrow();
      expect(() => playoffRowToTimingRow(empty, 'combined', 0)).not.toThrow();
    }
  });

  test('normalizes explicit completion timestamps independently from submittedAt and cache time', () => {
    const done = Date.parse('2026-11-09T06:35:00Z');
    for (const [field, value] of [['evaluatedAt', done], ['completedAt', String(done)], ['updatedAt', '2026-11-09T06:35:00Z']] as const) {
      expect(normalizePlayoffRow({ ...upstream.rows[0], [field]: value }).evaluatedAt).toBe(done);
    }
    expect(normalizePlayoffRow({ ...upstream.rows[0], evaluatedAt: done, completedAt: done + 1000, updatedAt: done + 2000 }).evaluatedAt).toBe(done);
    expect(normalizePlayoffRow({ ...upstream.rows[0], evaluatedAt: 'invalid', completedAt: done }).evaluatedAt).toBe(done);
    expect(normalizePlayoffRow({ ...upstream.rows[0], fetchedAt: done, at: done }).evaluatedAt).toBeNull();
    expect(normalizePlayoffRow({ submittedAt: done, evaluatedAt: 'invalid', updatedAt: '' }).evaluatedAt).toBeNull();
  });
});

describe('playoffStartsAt', () => {
  test('上游 startsAt 返回 15:00 时，按官方提测 12:00 展示', () => {
    expect(playoffStartsAt({ startsAt: 1794207600000 })).toBe(1794196800000);
    expect(playoffStartsAt({ startsAt: 1794196800000 })).toBe(1794196800000);
  });
});

describe('normalizePlayoffEntry / Submission', () => {
  test('毫秒时间戳与提测配置', () => {
    expect(normalizePlayoffEntry(upstream.entry)).toMatchObject({
      questionId: 600081,
      startsAt: 1794196800000,
      endsAt: 1794974400000,
      phase: 'UPCOMING',
    });
    expect(normalizePlayoffSubmission(upstream.submission)).toMatchObject({
      maxScore: 80,
      submissionType: 'CODE',
      evaluationMode: 'STANDARD_PULL',
      resultFormat: 'PLAYOFF',
      available: true,
    });
    expect(normalizePlayoffSubmission(upstream.submission).requiredFields[0]!.label).toBe('代码仓库地址');
  });
});

describe('getPlayoffInfo', () => {
  test('聚合入口、提测配置与题目介绍', async () => {
    const info = await getPlayoffInfo();
    expect(info.entry?.questionId).toBe(600081);
    expect(info.submission?.maxScore).toBe(80);
    expect(info.question?.introduce).toContain('题目介绍');
    expect(info.error).toBeNull();
  });

  test('提测配置失败时仍返回入口信息', async () => {
    const onlyEntry: FetchFn = async (input) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const ok = (data: unknown) => Response.json({ code: 200, data });
      if (url.pathname.endsWith('playoff/entry')) return ok(upstream.entry);
      return new Response('down', { status: 502 });
    };
    setFetch(onlyEntry);
    const info = await getPlayoffInfo();
    expect(info.entry?.questionId).toBe(600081);
    expect(info.submission).toBeNull();
    expect(info.submissionError).toContain('HTTP 502');
  });
});

describe('getPlayoffLeaderboard', () => {
  test('成功时带上游字段；失败且无兜底时返回空榜与错误', async () => {
    const ok = await getPlayoffLeaderboard(600081, 'combined');
    expect(ok.rows).toHaveLength(1);
    expect(ok.rows[0]!.combinedRank).toBe(1);
    expect(ok.error).toBeNull();

    clearCache();
    upstream.fail = true;
    const bad = await getPlayoffLeaderboard(600081, 'performance');
    expect(bad.rows).toEqual([]);
    expect(bad.error).toContain('HTTP 502');
  }, 10_000);
});

describe('playoff Row 映射', () => {
  test('三个榜取各自的排名分，学校/省份由初赛 meta 补齐', () => {
    const row = normalizePlayoffRow(upstream.rows[0]);
    const meta = { school: '测试大学', advisor: '张老师', province: '浙江省' };
    expect(playoffRowToRow(row, 'combined', 0, meta)).toMatchObject({
      rank: 1,
      name: '队A',
      school: '测试大学',
      province: '浙江省',
      score: 670.25,
      bestSubmit: null,
      updated: '2026-11-09T06:30:00.000Z',
    });
    expect(playoffRowToRow(row, 'performance', 0, meta).score).toBe(123.456789);
    expect(playoffRowToRow(row, 'prompt', 0, meta).score).toBe(88.5);
  });

  test('maps submittedAt to bestSubmit and explicit evaluatedAt to updated for timing samples', () => {
    const done = Date.parse('2026-11-09T06:35:00Z');
    const row = normalizePlayoffRow({ ...upstream.rows[0], completedAt: done });
    for (const key of ['combined', 'performance', 'prompt'] as const) {
      expect(playoffRowToTimingRow(row, key, 0)).toMatchObject({ bestSubmit: '2026-11-09T06:30:00.000Z', updated: '2026-11-09T06:35:00.000Z' });
      expect(playoffRowToRow(row, key, 0)).toMatchObject({ bestSubmit: null, updated: '2026-11-09T06:30:00.000Z' });
    }
    expect(playoffRowToTimingRow({ ...row, evaluatedAt: undefined }, 'combined', 0).updated).toBeNull();
  });

  test('buildPlayoffTeamMeta 总榜优先、后面的榜只补空字段', () => {
    const base = {
      questionId: null,
      error: null,
      stale: false,
      reportedTotal: 1,
      source: '',
    };
    const total = {
      ...base,
      id: 'playoff-combined',
      title: '加赛总榜',
      kind: 'total' as const,
      rows: [{ ...playoffRowToRow(normalizePlayoffRow(upstream.rows[0]), 'combined', 0), school: '总榜大学', province: '江苏省' }],
    } as Board;
    const track = {
      ...base,
      id: 'playoff-performance',
      title: '性能榜',
      kind: 'track' as const,
      rows: [{ ...playoffRowToRow(normalizePlayoffRow(upstream.rows[0]), 'performance', 0), school: '', province: '浙江省' }],
    } as Board;
    const meta = buildPlayoffTeamMeta([track, total]);
    expect(meta.get(7)).toEqual({ school: '总榜大学', advisor: '', province: '江苏省' });
  });
});

describe('Hono playoff routes', () => {
  const app = createApi({ runtime: 'bun', pushIntervalMs: null });

  test('/api/playoff 与 /api/playoff/leaderboard', async () => {
    const info = await (await app.request('/api/playoff')).json();
    expect(info.entry.questionId).toBe(600081);
    expect(info.submission.maxScore).toBe(80);

    const board = await (await app.request('/api/playoff/leaderboard?board=combined')).json();
    expect(board.board).toBe('combined');
    expect(board.rows[0].groupName).toBe('队A');
  });

  test('非法 board 返回 400', async () => {
    const res = await app.request('/api/playoff/leaderboard?board=nope');
    expect(res.status).toBe(400);
  });

  test('/api/playoff/export.csv 导出一题两子题合并榜', async () => {
    const res = await app.request('/api/playoff/export.csv?sort=performance');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('combinedRank,team,school,advisor,province,performance,performanceRank,performancePoints,promptRawScore');
    expect(text).toContain('队A');
  }, 10_000);
});


describe('加赛一题两子题合并', () => {
  const row = (patch: Partial<PlayoffRow>): PlayoffRow => ({
    groupId: null,
    groupName: '队',
    performance: null,
    performancePoints: null,
    performanceRank: null,
    promptRawScore: null,
    promptPoints: null,
    promptRank: null,
    combinedRank: null,
    playoffScore: null,
    preliminaryScore: null,
    totalScore: null,
    submittedAt: null,
    evaluatedAt: null,
    ...patch,
  });
  const board = (b: PlayoffLeaderboard['board'], rows: PlayoffRow[]): PlayoffLeaderboard => ({
    board: b,
    provisional: true,
    activityCode: 1,
    resultSequence: 1,
    total: rows.length,
    pageNo: 1,
    pageSize: 100,
    rows,
    performanceTop: [],
    promptTop: [],
    error: null,
    stale: false,
    at: 1,
  });

  test('combined 先入、子榜补空、只出现在子榜的队伍也保留', () => {
    const teams = mergePlayoffTeams(
      {
        combined: board('combined', [row({ groupId: 7, groupName: '队A', combinedRank: 1, totalScore: 670, submittedAt: 1000 })]),
        performance: board('performance', [
          row({ groupId: 7, groupName: '队A', performance: 0.99, performanceRank: 2, performancePoints: 39.5, evaluatedAt: 5000 }),
          row({ groupId: 8, groupName: '队B', performance: 0.88, performanceRank: 9 }),
        ]),
        prompt: board('prompt', [row({ groupId: 7, groupName: '队A', promptRawScore: 88, promptRank: 3, promptPoints: 38 })]),
      },
      new Map([[7, { school: '浙江大学', advisor: '老师', province: '浙江省' }]]),
    );
    expect(teams).toHaveLength(2);
    const a = teams.find((t) => t.groupId === 7)!;
    expect(a).toMatchObject({ combinedRank: 1, totalScore: 670, performance: 0.99, performanceRank: 2, promptRawScore: 88, promptRank: 3, school: '浙江大学', province: '浙江省' });
    expect(a.submittedAt).toBe(1000);
    expect(a.evaluatedAt).toBe(5000);
    expect(teams.find((t) => t.groupId === 8)?.name).toBe('队B');
  });

  test('排序：官方名次优先，缺维度固定沉底；搜索空格全命中', () => {
    const teams: PlayoffTeamRow[] = [
      { key: 'g1', groupId: 1, name: '甲队', school: '浙江大学', advisor: '张老师', province: '浙江省', performance: 0.9, performancePoints: 40, performanceRank: 2, promptRawScore: 90, promptPoints: 39, promptRank: 1, combinedRank: 3, playoffScore: 70, preliminaryScore: 600, totalScore: 670, submittedAt: 1, evaluatedAt: null },
      { key: 'g2', groupId: 2, name: '乙队', school: '清华大学', advisor: '李老师', province: '北京市', performance: 0.99, performancePoints: 40, performanceRank: 1, promptRawScore: null, promptPoints: null, promptRank: null, combinedRank: 1, playoffScore: 80, preliminaryScore: 610, totalScore: 690, submittedAt: 2, evaluatedAt: null },
      { key: 'g3', groupId: 3, name: '丙队', school: '北京大学', advisor: '王老师', province: '北京市', performance: null, performancePoints: null, performanceRank: null, promptRawScore: 80, promptPoints: 37, promptRank: 3, combinedRank: null, playoffScore: null, preliminaryScore: 590, totalScore: null, submittedAt: 3, evaluatedAt: null },
    ];
    expect(sortPlayoffTeams(teams, 'performance').map((t) => t.name)).toEqual(['乙队', '甲队', '丙队']);
    expect(sortPlayoffTeams(teams, 'prompt').map((t) => t.name)).toEqual(['甲队', '丙队', '乙队']);
    expect(searchPlayoffTeams(teams, '浙江 张')).toHaveLength(1);
    expect(searchPlayoffTeams(teams, '北京')).toHaveLength(2);
  });

  test('初赛总榜前 50 名从加赛合并行中剔除', () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      rank: 1, // 上游没有官方名次字段；同分并列时页面 rank 均为 1，必须按上游顺序截前 50。
      name: `队${i + 1}`,
      school: '',
      advisor: '',
      province: '',
      score: 620,
      rawScore: null,
      bestSubmit: null,
      updated: null,
      userId: null,
      groupId: i + 1,
      recordId: null,
    }));
    const initial = [
      {
        id: 'total',
        title: '总榜',
        kind: 'total' as const,
        questionId: null,
        error: null,
        stale: false,
        reportedTotal: 51,
        source: '',
        rows,
      },
    ] as Board[];
    expect(playoffTop50Keys(initial).size).toBe(50);
    expect(playoffTop50Keys(initial).has('g1')).toBe(true);
    expect(playoffTop50Keys(initial).has('g51')).toBe(false);
    const teams = [
      { key: 'g1', groupId: 1, name: '队1' },
      { key: 'g51', groupId: 51, name: '队51' },
    ] as PlayoffTeamRow[];
    expect(excludePlayoffTop50(teams, initial).map((t) => t.name)).toEqual(['队51']);
  });
});
