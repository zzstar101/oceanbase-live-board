// 加赛榜：官方 /competition/playoff 的镜像。
// 数据接口与初赛不同：加赛题 600081 走 playoff/entry、playoff/leaderboard、taskrecord/submissionOptions。
// 交互沿用初赛榜：榜单 chips、省份/搜索、KPI、分布、省份与学校、关注、队伍详情、CSV。
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtScore, fmtTime, timeAgo } from '../../shared/format.ts';
import { buildPlayoffTeamMeta, playoffRowToRow } from '../../shared/playoff.ts';
import type { Board, PlayoffBoardKey, PlayoffInfo, PlayoffLeaderboard, Snapshot } from '../../shared/types.ts';
import { Footer } from '../components/Footer.tsx';
import { Header } from '../components/Header.tsx';
import { LeaderboardView, type LeaderboardTab } from '../components/LeaderboardView.tsx';
import { PlayoffStandingPanel, PlayoffTimingPanel } from '../components/PlayoffPanels.tsx';
import { StarPrompt } from '../components/StarPrompt.tsx';
import { Card, Pill, Stat } from '../components/ui.tsx';
import { fetchPlayoffBoard, fetchPlayoffInfo, playoffCsvUrl } from '../lib/api.ts';
import { useNow } from '../lib/hooks.ts';
import { useLive } from '../lib/live.tsx';
import { playoffRoute, type PlayoffSearch } from '../router.tsx';

const BOARDS: {
  key: PlayoffBoardKey;
  title: string;
  short: string;
  hint: string;
  scoreHeader: string;
  digits: number;
}[] = [
  {
    key: 'combined',
    title: '加赛总榜',
    short: '加赛总榜',
    hint: '性能 + Prompt + 初赛分加权',
    scoreHeader: '总分',
    digits: 2,
  },
  {
    key: 'performance',
    title: '性能榜',
    short: '性能榜',
    hint: '按性能指标 E 排名',
    scoreHeader: '性能指标 E',
    digits: 6,
  },
  {
    key: 'prompt',
    title: 'Agent Prompt 榜',
    short: 'Prompt 榜',
    hint: '按 Prompt 原始分排名',
    scoreHeader: 'Prompt 原始分',
    digits: 2,
  },
];

const PHASE: Record<string, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'brand' }> = {
  UPCOMING: { label: '未开始', tone: 'amber' },
  RUNNING: { label: '进行中', tone: 'green' },
  ENDED: { label: '已结束', tone: 'slate' },
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 「2 小时 25 分 13 秒」 */
function fmtCountdown(ms: number) {
  const diff = Math.max(0, ms);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${d > 0 ? `${d} 天 ` : ''}${h} 小时 ${m} 分 ${s} 秒`;
}

export function PlayoffPage() {
  const search = playoffRoute.useSearch();
  const navigate = useNavigate({ from: '/playoff' });
  const board = search.board ?? 'combined';
  const now = useNow(1000);
  const { data: live } = useLive();
  const initialSnap = live?.snap;

  const [info, setInfo] = useState<PlayoffInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [boards, setBoards] = useState<Partial<Record<PlayoffBoardKey, PlayoffLeaderboard>>>({});
  const [boardError, setBoardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadInfo = useCallback(async (force = false) => {
    try {
      const next = await fetchPlayoffInfo(force);
      setInfo(next);
      setInfoError(next.error);
    } catch (e) {
      setInfoError(errText(e));
    }
  }, []);

  useEffect(() => {
    void loadInfo();
    const id = setInterval(() => void loadInfo(), 60_000);
    return () => clearInterval(id);
  }, [loadInfo]);

  const questionId = info?.entry?.questionId;

  const loadBoards = useCallback(
    async (force = false, spin = false) => {
      if (spin) setRefreshing(true);
      const results = await Promise.all(
        BOARDS.map(async (b) => {
          try {
            return [b.key, await fetchPlayoffBoard(b.key, questionId)] as const;
          } catch {
            return [b.key, null] as const;
          }
        }),
      );
      const next: Partial<Record<PlayoffBoardKey, PlayoffLeaderboard>> = {};
      let firstError: string | null = null;
      for (const [key, value] of results) {
        if (value) {
          next[key] = value;
          firstError ||= value.error;
        } else {
          firstError ||= '榜单读取失败';
        }
      }
      setBoards((prev) => {
        const merged = { ...prev };
        for (const [key, value] of Object.entries(next)) merged[key as PlayoffBoardKey] = value;
        return merged;
      });
      setBoardError(firstError);
      setLoading(false);
      if (spin) setRefreshing(false);
    },
    [questionId],
  );

  useEffect(() => {
    setLoading(true);
    void loadBoards();
    const id = setInterval(() => void loadBoards(), 15_000);
    return () => clearInterval(id);
  }, [loadBoards]);

  const entry = info?.entry;
  // 上游 phase 可能滞后，开赛/结束状态以时间戳为准。
  const phaseKey = !entry ? '' : now < entry.startsAt ? 'UPCOMING' : now < entry.endsAt ? 'RUNNING' : 'ENDED';
  const phase = PHASE[phaseKey] ?? { label: entry?.phase || '—', tone: 'slate' as const };

  // 初赛快照只用于补学校/省份/导师；加赛接口本身不返回这些字段。
  const teamMeta = useMemo(() => buildPlayoffTeamMeta(initialSnap?.boards ?? []), [initialSnap]);
  const playoffBoards: Board[] = useMemo(
    () =>
      BOARDS.map((def) => {
        const data = boards[def.key];
        const rows = (data?.rows ?? [])
          .map((r, i) => playoffRowToRow(r, def.key, i, r.groupId != null ? teamMeta.get(r.groupId) : null))
          .toSorted((a, b) => a.rank - b.rank || (b.score ?? -1) - (a.score ?? -1));
        return {
          id: `playoff-${def.key}`,
          title: def.title,
          kind: def.key === 'combined' ? 'total' : 'track',
          questionId: entry?.questionId ?? null,
          rows,
          error: data?.error ?? null,
          stale: data?.stale ?? false,
          reportedTotal: data?.total ?? null,
          source: 'https://open.oceanbase.com/competition/playoff',
        };
      }),
    [boards, teamMeta, entry?.questionId],
  );

  const playoffSnap: Snapshot = useMemo(
    () => ({
      campId: entry?.campId ?? 21,
      generatedAt: info?.generatedAt ?? new Date().toISOString(),
      boards: playoffBoards,
    }),
    [entry?.campId, info?.generatedAt, playoffBoards],
  );

  const activeBoard = playoffBoards.find((b) => b.id === `playoff-${board}`) ?? playoffBoards[0]!;
  const activeDef = BOARDS.find((b) => b.key === board) ?? BOARDS[0]!;
  const rows = activeBoard.rows;
  const top = rows[0];

  const setBoard = useCallback(
    (id: string) => {
      const key = BOARDS.find((b) => `playoff-${b.key}` === id)?.key ?? 'combined';
      void navigate({
        search: (prev: PlayoffSearch) => ({ ...prev, board: key === 'combined' ? undefined : key, team: undefined }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSearch = useCallback(
    (patch: Partial<PlayoffSearch>, replace = true) => {
      void navigate({ search: (prev: PlayoffSearch) => ({ ...prev, ...patch }), replace });
    },
    [navigate],
  );

  const openTeam = useCallback(
    (key: string) => {
      void navigate({ search: (prev: PlayoffSearch) => ({ ...prev, team: key }), replace: false });
    },
    [navigate],
  );

  const progress = useMemo(() => {
    if (!entry) return { label: '', value: '' };
    if (now < entry.startsAt) return { label: '距加赛开始', value: fmtCountdown(entry.startsAt - now) };
    if (now < entry.endsAt) return { label: '距加赛结束', value: fmtCountdown(entry.endsAt - now) };
    return { label: '比赛状态', value: '已结束' };
  }, [entry, now]);

  const kpis = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="榜单队伍"
        value={activeBoard.reportedTotal ?? '—'}
        sub={boards[board]?.provisional ? '暂定榜单 · 随提测更新' : '正式榜单'}
        tone="brand"
      />
      <Stat label="榜首队伍" value={top?.name ?? '—'} sub={top ? '当前第 1 名' : '暂无成绩'} />
      <Stat label={`榜首${activeDef.scoreHeader}`} value={fmtScore(top?.score, activeDef.digits)} sub={activeDef.hint} />
      <Stat
        label="数据更新"
        value={boards[board]?.at ? timeAgo(boards[board]!.at!, now) : '—'}
        sub={boards[board]?.stale ? '上游异常 · 显示上次数据' : '每 15 秒自动刷新'}
      />
    </div>
  );

  const tabs: LeaderboardTab[] = [
    { id: 'rank', label: '排行榜', show: true },
    { id: 'dist', label: '分数分布', show: true },
    { id: 'region', label: '省份与学校', show: true },
    { id: 'promo', label: '晋级形势', show: true },
    { id: 'timing', label: '出分耗时与预测', show: true },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <title>{`加赛榜${entry?.questionName ? ` · ${entry.questionName}` : ''} - OceanBase 榜单实时看板`}</title>
      <Header />
      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        {loading && !info ? (
          <Card>
            <div className="animate-pulse space-y-2 py-4" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 rounded bg-slate-100 dark:bg-slate-800/60" />
              ))}
            </div>
          </Card>
        ) : (
          <LeaderboardView
            snap={playoffSnap}
            boards={playoffBoards}
            board={activeBoard}
            search={search}
            onSearch={setSearch}
            onPickBoard={setBoard}
            tabs={tabs}
            panels={{
              promo: <PlayoffStandingPanel board={activeBoard} province={search.province || ''} digits={activeDef.digits} onOpen={openTeam} />,
              timing: <PlayoffTimingPanel board={activeBoard} digits={activeDef.digits} onOpen={openTeam} />,
            }}
            totalLabel="加赛总榜"
            kpis={kpis}
            csvHref={playoffCsvUrl(board, search.province || '')}
            scoreDigits={activeDef.digits}
            scoreHeader={activeDef.scoreHeader}
            footerNote={
              board === 'combined'
                ? '总分 = 加赛综合分 + 初赛分。'
                : board === 'performance'
                  ? '性能榜按性能指标 E 排名。'
                  : 'Prompt 榜按 Prompt 原始分排名。'
            }
            banner={
              <>
                <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {entry?.questionName || '加赛'}
                    </span>
                    <Pill tone={phase.tone}>{phase.label}</Pill>
                  </div>
                  <span className="text-[13px] text-slate-500 dark:text-slate-400">
                    {entry ? `${fmtTime(entry.startsAt)} 至 ${fmtTime(entry.endsAt)} · 北京时间` : '读取赛程中…'}
                  </span>
                  {progress.value && (
                    <span className="text-[13px] text-slate-500 dark:text-slate-400">
                      {progress.label}{' '}
                      <b className="num font-semibold text-brand-600 dark:text-brand-300">{progress.value}</b>
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <a className="btn" href="https://open.oceanbase.com/competition/playoff" target="_blank" rel="noreferrer">
                      官方页面 ↗
                    </a>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void loadInfo(true);
                        void loadBoards(true, true);
                      }}
                      disabled={refreshing}
                    >
                      {refreshing ? '刷新中…' : '刷新'}
                    </button>
                  </div>
                </div>
                {(infoError || (boardError && !activeBoard.error)) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    {infoError ? `加赛信息读取失败：${infoError}` : `部分榜单读取失败：${boardError}`}
                  </div>
                )}
              </>
            }
          />
        )}
      </main>
      <Footer />
      <StarPrompt />
    </div>
  );
}
