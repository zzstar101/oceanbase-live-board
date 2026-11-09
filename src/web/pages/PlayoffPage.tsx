// 加赛单题页：一个题目（600081）下两个子题（性能评测 / Agent Prompt 评价），
// 一支队伍只提测一次，两个子题的成绩在同一条记录里展示。
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtScore, fmtTime, timeAgo } from '../../shared/format.ts';
import {
  buildPlayoffTeamMeta,
  excludePlayoffTop50,
  mergePlayoffTeams,
  playoffSortRank,
  playoffSortScore,
  playoffStartsAt,
  playoffTeamToRow,
  playoffTop50Keys,
  searchPlayoffTeams,
  sortPlayoffTeams,
  type PlayoffSort,
  type PlayoffTeamRow,
} from '../../shared/playoff.ts';
import { filterByProvince, provinceStats } from '../../shared/province.ts';
import type { Board, PlayoffBoardKey, PlayoffInfo, PlayoffLeaderboard, Row, Snapshot } from '../../shared/types.ts';
import { Footer } from '../components/Footer.tsx';
import { Header } from '../components/Header.tsx';
import { FeedPanel } from '../components/FeedPanel.tsx';
import { PlayoffStandingPanel, PlayoffTimingPanel } from '../components/PlayoffPanels.tsx';
import { PlayoffStarBar } from '../components/PlayoffStarBar.tsx';
import { LeaderTable } from '../components/LeaderTable.tsx';
import { PlayoffTeamDialog } from '../components/PlayoffTeamDialog.tsx';
import { ProvinceMap } from '../components/ProvinceMap.tsx';
import { ScoreDist } from '../components/ScoreDist.tsx';
import { RegionPanel } from '../components/RegionPanel.tsx';
import { Sponsors } from '../components/Sponsors.tsx';
import { StarPrompt } from '../components/StarPrompt.tsx';
import { Card, Empty, Pill, Stat } from '../components/ui.tsx';
import { fetchPlayoffBoard, fetchPlayoffInfo, playoffCsvUrl } from '../lib/api.ts';
import { useNow } from '../lib/hooks.ts';
import { useLive } from '../lib/live.tsx';
import { playoffRoute, type PlayoffSearch } from '../router.tsx';

const PAGE_SIZE = 100;
const REFRESH_MS = 30_000;
const SORTS: { key: PlayoffSort; label: string }[] = [
  { key: 'combined', label: '综合（总分）' },
  { key: 'performance', label: '性能' },
  { key: 'prompt', label: 'Prompt' },
];
const PHASE: Record<string, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'brand' }> = {
  UPCOMING: { label: '未开始', tone: 'amber' },
  RUNNING: { label: '进行中', tone: 'green' },
  ENDED: { label: '已结束', tone: 'slate' },
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fmtCountdown(ms: number) {
  const diff = Math.max(0, ms);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${d > 0 ? `${d} 天 ` : ''}${h} 小时 ${m} 分 ${s} 秒`;
}

function toSortRow(t: PlayoffTeamRow, sort: PlayoffSort, i: number): Row {
  const score = playoffSortScore(t, sort);
  return {
    rank: playoffSortRank(t, sort) ?? i + 1,
    name: t.name,
    school: t.school,
    advisor: t.advisor,
    province: t.province,
    score,
    rawScore: score == null ? null : Math.round(score * 1000),
    bestSubmit: null,
    updated: t.evaluatedAt != null ? new Date(t.evaluatedAt).toISOString() : t.submittedAt != null ? new Date(t.submittedAt).toISOString() : null,
    userId: null,
    groupId: t.groupId,
    recordId: null,
  };
}

export function PlayoffPage() {
  const search = playoffRoute.useSearch();
  const navigate = useNavigate({ from: '/playoff' });
  const now = useNow(1000);
  const { data: live } = useLive();
  const initialSnap = live?.snap;
  const sort: PlayoffSort = search.sort ?? 'combined';
  const tab = search.tab ?? 'rank';

  const [info, setInfo] = useState<PlayoffInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [boards, setBoards] = useState<Partial<Record<PlayoffBoardKey, PlayoffLeaderboard>>>({});
  const [pageNo, setPageNo] = useState(1);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [qDraft, setQDraft] = useState(search.q ?? '');
  const pageNoRef = useRef(1);

  const questionId = info?.entry?.questionId;

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

  /** 拉取 1..maxPage 的所有页；用于首屏、刷新和当前已展开范围的 30s 轮询。 */
  const loadPages = useCallback(
    async (maxPage: number, force = false) => {
      const results = await Promise.all(
        (['combined', 'performance', 'prompt'] as const).map(async (key) => {
          try {
            const pages = await Promise.all(
              Array.from({ length: maxPage }, (_, i) => fetchPlayoffBoard(key, questionId, i + 1, PAGE_SIZE)),
            );
            const first = pages[0]!;
            return [
              key,
              {
                ...first,
                rows: pages.flatMap((p) => p.rows),
                pageNo: maxPage,
                pageSize: PAGE_SIZE,
              },
            ] as const;
          } catch (e) {
            return [key, { error: errText(e) }] as const;
          }
        }),
      );
      const firstError = results.find(([, value]) => !('rows' in value))?.[1];
      setBoards((prev) => {
        const next = { ...prev };
        for (const [key, value] of results) {
          if ('rows' in value) next[key] = value;
        }
        return next;
      });
      setBoardError(firstError && 'error' in firstError ? firstError.error : null);
    },
    [questionId],
  );

  useEffect(() => {
    setLoading(true);
    pageNoRef.current = 1;
    setPageNo(1);
    void loadPages(1).finally(() => setLoading(false));
  }, [loadPages]);

  useEffect(() => {
    pageNoRef.current = pageNo;
  }, [pageNo]);

  useEffect(() => {
    const id = setInterval(() => void loadPages(pageNoRef.current, true), REFRESH_MS);
    return () => clearInterval(id);
  }, [loadPages]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const nextPage = pageNo + 1;
    try {
      const results = await Promise.all(
        (['combined', 'performance', 'prompt'] as const).map(async (key) => {
          try {
            return [key, await fetchPlayoffBoard(key, questionId, nextPage, PAGE_SIZE)] as const;
          } catch {
            return [key, null] as const;
          }
        }),
      );
      setBoards((prev) => {
        const next = { ...prev };
        for (const [key, value] of results) {
          if (!value) continue;
          const current = next[key];
          if (!current) {
            next[key] = value;
            continue;
          }
          const seen = new Set(current.rows.map((r) => `${r.groupId ?? r.groupName}`));
          next[key] = {
            ...current,
            ...value,
            rows: [...current.rows, ...value.rows.filter((r) => !seen.has(`${r.groupId ?? r.groupName}`))],
            pageNo: nextPage,
            pageSize: PAGE_SIZE,
          };
        }
        return next;
      });
      setPageNo(nextPage);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, pageNo, questionId]);

  useEffect(() => setQDraft(search.q ?? ''), [search.q]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (qDraft !== (search.q ?? '')) {
        void navigate({ search: (prev: PlayoffSearch) => ({ ...prev, q: qDraft || undefined, team: undefined }), replace: true });
      }
    }, 250);
    return () => clearTimeout(id);
  }, [qDraft, search.q, navigate]);

  const entry = info?.entry;
  const startsAt = entry ? playoffStartsAt(entry) : 0;
  const phaseKey = !entry ? '' : now < startsAt ? 'UPCOMING' : now < entry.endsAt ? 'RUNNING' : 'ENDED';
  const phase = PHASE[phaseKey] ?? { label: entry?.phase || '—', tone: 'slate' as const };
  const progress = useMemo(() => {
    if (!entry) return { label: '', value: '' };
    if (now < startsAt) return { label: '距加赛开始', value: fmtCountdown(startsAt - now) };
    if (now < entry.endsAt) return { label: '距加赛结束', value: fmtCountdown(entry.endsAt - now) };
    return { label: '比赛状态', value: '已结束' };
  }, [entry, startsAt, now]);

  // 初赛快照只用于补学校/省份/导师；加赛接口本身不返回这些字段。
  const teamMeta = useMemo(() => buildPlayoffTeamMeta(initialSnap?.boards ?? []), [initialSnap]);
  // 初赛前 50 名直接晋级决赛，不参加加赛；即使上游榜单误带，也在页面侧剔除。
  const initialTop50Keys = useMemo(() => playoffTop50Keys(initialSnap?.boards), [initialSnap]);
  const rawTeams = useMemo(() => mergePlayoffTeams(boards, teamMeta), [boards, teamMeta]);
  const teams = useMemo(() => excludePlayoffTop50(rawTeams, initialSnap?.boards), [rawTeams, initialSnap]);
  const sorted = useMemo(() => sortPlayoffTeams(teams, sort), [teams, sort]);
  const provinceRows = useMemo(() => filterByProvince(sorted, search.province || ''), [sorted, search.province]);
  const shownRows = useMemo(() => searchPlayoffTeams(provinceRows, search.q), [provinceRows, search.q]);
  const totalRows = useMemo(() => teams.map((t, i) => playoffTeamToRow(t, i)), [teams]);
  const provinces = useMemo(() => provinceStats(totalRows), [totalRows]);
  const totalBoard: Board = useMemo(
    () => ({
      id: 'playoff-total',
      title: '加赛总榜',
      kind: 'total',
      questionId: entry?.questionId ?? null,
      rows: totalRows,
      error: boardError,
      stale: Boolean(boards.combined?.stale),
      reportedTotal: boards.combined?.total ?? null,
      source: 'https://open.oceanbase.com/competition/playoff',
    }),
    [entry?.questionId, totalRows, boardError, boards.combined?.stale, boards.combined?.total],
  );
  const feedBoard: Board = useMemo(
    () => ({ ...totalBoard, id: 'playoff-feed', title: '加赛总分', kind: 'track' }),
    [totalBoard],
  );
  const snap: Snapshot = useMemo(
    () => ({ campId: entry?.campId ?? 21, generatedAt: info?.generatedAt ?? new Date().toISOString(), boards: [totalBoard, feedBoard] }),
    [entry?.campId, info?.generatedAt, totalBoard, feedBoard],
  );
  const distRows = useMemo(
    () => sorted.filter((t) => playoffSortScore(t, sort) != null).map((t, i) => toSortRow(t, sort, i)),
    [sorted, sort],
  );
  const distBoard: Board = useMemo(
    () => ({
      ...totalBoard,
      id: `playoff-dist-${sort}`,
      title: sort === 'combined' ? '加赛总榜' : sort === 'performance' ? '性能子题' : 'Prompt 子题',
      rows: distRows,
    }),
    [totalBoard, sort, distRows],
  );
  // 总榜沿用初赛榜的列结构与交互：排名、队伍、学校、省份、导师、成绩、更新时间。
  const tableRows = useMemo(() => shownRows.map((t, i) => toSortRow(t, sort, i)), [shownRows, sort]);
  const tableBoard: Board = useMemo(
    () => ({
      ...totalBoard,
      id: `playoff-table-${sort}`,
      title: sort === 'combined' ? '加赛总榜' : sort === 'performance' ? '性能子题' : 'Prompt 子题',
      kind: sort === 'combined' ? 'total' : 'track',
      rows: tableRows,
    }),
    [totalBoard, sort, tableRows],
  );

  const top = sorted.find((t) => t.combinedRank != null) ?? null;
  const cutoff = teams.filter((t) => t.combinedRank != null && t.totalScore != null).sort((a, b) => a.combinedRank! - b.combinedRank!)[49];
  const setSearch = useCallback(
    (patch: Partial<PlayoffSearch>, replace = true) => {
      void navigate({ search: (prev: PlayoffSearch) => ({ ...prev, ...patch }), replace });
    },
    [navigate],
  );
  const setSort = (next: PlayoffSort) => {
    setSearch({ sort: next === 'combined' ? undefined : next, team: undefined });
  };
  const setTab = (next: typeof tab) => {
    setSearch({ tab: next === 'rank' ? undefined : next, team: undefined }, false);
  };
  const openTeam = useCallback(
    (key: string) => {
      void navigate({ search: (prev: PlayoffSearch) => ({ ...prev, team: key }), replace: false });
    },
    [navigate],
  );
  const selectedTeam = search.team ? teams.find((t) => t.key === search.team) ?? null : null;
  const officialTotal = boards.combined?.total ?? 0;
  const allLoaded = officialTotal > 0 ? pageNo * PAGE_SIZE >= officialTotal : true;
  const excludedSeen = rawTeams.length - teams.length;
  const total = allLoaded ? teams.length : Math.max(teams.length, officialTotal - excludedSeen);
  const shown = shownRows.length;

  const tabs = [
    ['rank', '排行榜'],
    ['dist', '分数分布'],
    ['region', '省份与学校'],
    ['promo', '晋级形势'],
    ['timing', '出分耗时与提交'],
  ] as const;

  const kpis = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="已出分队伍" value={total} sub={initialTop50Keys.size > 0 ? `已剔除初赛前 ${initialTop50Keys.size} 名` : boards.combined?.provisional ? '暂定榜单 · 随提测更新' : '已进入加赛榜'} tone="brand" />
      <Stat label="综合榜首" value={top?.name ?? '—'} sub={top ? `总分 ${fmtScore(top.totalScore, 2)}` : '暂无成绩'} />
      <Stat label="综合第 50 名线" value={fmtScore(cutoff?.totalScore ?? null, 2)} sub="加赛前 50 名获新增名额" />
      <Stat label="数据更新" value={boards.combined?.at ? timeAgo(boards.combined.at, now) : '—'} sub={boards.combined?.stale ? '上游异常 · 上次数据' : '每 30 秒自动刷新'} />
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <title>{`加赛 · ${entry?.questionName || '轻量向量数据库'} - OceanBase 榜单实时看板`}</title>
      <Header />
      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        {loading ? (
          <Card><div className="animate-pulse space-y-2 py-4" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 rounded bg-slate-100 dark:bg-slate-800/60" />)}</div></Card>
        ) : (
          <>
            <section className="card px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-x-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold tracking-tight">{entry?.questionName || '轻量向量数据库（MiniVectorDB）'}</h1>
                    <Pill tone={phase.tone}>{phase.label}</Pill>
                    <Pill tone="brand">1 次提测 · 2 个子题</Pill>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <span className="badge bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">性能评测 40 分</span>
                    <span className="badge bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Agent Prompt 评价 40 分</span>
                    <span>加赛满分 {info?.submission?.maxScore ?? 80} 分</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    一次提交同时产生两项成绩；性能和 Prompt 分别排名，单项无效不影响另一项。总分 = 初赛分 + 加赛综合分。
                  </p>
                  {initialTop50Keys.size > 0 && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                      初赛前 {initialTop50Keys.size} 名已直接晋级决赛，不参加加赛，已从加赛榜与统计中剔除。
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a className="btn" href="https://open.oceanbase.com/train/detail/21?questionId=600081" target="_blank" rel="noreferrer">赛题说明 ↗</a>
                  <a className="btn" href="https://open.oceanbase.com/competition/playoff" target="_blank" rel="noreferrer">官方页面 ↗</a>
                  <button type="button" className="btn" disabled={refreshing} onClick={() => { setRefreshing(true); void Promise.all([loadInfo(true), loadPages(pageNo, true)]).finally(() => setRefreshing(false)); }}>{refreshing ? '刷新中…' : '刷新'}</button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500 dark:text-slate-400">
                <span>{entry ? `${fmtTime(startsAt)} 至 ${fmtTime(entry.endsAt)} · 北京时间` : '读取赛程中…'}</span>
                {progress.value && <span>{progress.label} <b className="num font-semibold text-brand-600 dark:text-brand-300">{progress.value}</b></span>}
              </div>
              {(infoError || boardError) && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">{infoError ? `加赛信息读取失败：${infoError}` : `部分榜单读取失败：${boardError}`}</div>}
            </section>

            <PlayoffStarBar teams={teams} onOpen={openTeam} />

            {kpis}

            <div className="card flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label="排序维度">
                {SORTS.map((s) => (
                  <button key={s.key} type="button" className={`rounded-md px-3 py-1.5 text-sm ${sort === s.key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</button>
                ))}
              </div>
              <select className="input max-w-[10rem] py-1.5" value={search.province ?? ''} onChange={(e) => setSearch({ province: e.target.value || undefined, team: undefined })} aria-label="省份">
                <option value="">全部省份</option>
                {provinces.filter((p) => p.province).map((p) => <option key={p.province} value={p.province}>{p.province}（{p.teams}）</option>)}
              </select>
              <input className="input min-w-[10rem] flex-1 py-1.5" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="搜索队伍 / 学校 / 导师 / 省份" aria-label="搜索队伍" />
              <span className="text-xs text-slate-500">显示 {shown} / 已加载 {teams.length}{total > teams.length ? ` / 共 ${total}` : ''}</span>
              {(search.province || search.q) && <button type="button" className="btn py-1.5" onClick={() => { setQDraft(''); setSearch({ province: undefined, q: undefined, team: undefined }); }}>清除筛选</button>}
              <a className="btn py-1.5" href={playoffCsvUrl(sort, search.province || '')}>导出 CSV</a>
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <section className="card min-w-0 overflow-hidden lg:flex lg:min-h-[calc(100dvh-5rem)] lg:flex-col">
                <nav className="flex shrink-0 gap-4 overflow-x-auto border-b border-slate-200 px-4 pt-2 dark:border-slate-700" aria-label="加赛视图">
                  {tabs.map(([id, label]) => <button key={id} type="button" className={`tab whitespace-nowrap ${tab === id ? 'tab-active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
                </nav>
                <div className="min-w-0 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[contain:size]">
                  {tab === 'rank' && (
                    teams.length === 0 ? (
                      <div className="py-20"><Empty>{phaseKey === 'UPCOMING' ? '加赛尚未开始，页面每 30 秒自动刷新。' : phaseKey === 'ENDED' ? '加赛已结束，暂无成绩。' : '加赛已开始，等待首批成绩；页面每 30 秒自动刷新。'}</Empty></div>
                    ) : (
                      <>
                        <LeaderTable
                          key={sort}
                          board={tableBoard}
                          rows={tableRows}
                          province={search.province || ''}
                          query={search.q || ''}
                          onOpen={openTeam}
                          scoreDigits={sort === 'performance' ? 6 : 2}
                          scoreHeader={sort === 'combined' ? '总分' : sort === 'performance' ? '性能指标 E' : 'Prompt 原始分'}
                          footerPrefix="点击任意一行查看该队两个子题成绩。名次按成绩排序、同分并列；"
                          timeHeader={teams.some((t) => t.evaluatedAt != null) ? '出分时间' : '提交时间'}
                          footerNote={sort === 'combined' ? '总分 = 初赛分 + 加赛综合分。' : sort === 'performance' ? '按性能子题名次排序，性能 E 保留 6 位小数。' : '按 Prompt 子题名次排序，Prompt 原始分保留 2 位小数。'}
                        />
                        {teams.length < total && (
                          <div className="mt-4 flex justify-center">
                            <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '加载中…' : `加载更多（每次 ${PAGE_SIZE} 队）`}</button>
                          </div>
                        )}
                      </>
                    )
                  )}
                  {tab === 'dist' && <ScoreDist board={distBoard} rows={distRows} province={search.province || ''} digits={sort === 'performance' ? 6 : 2} onOpen={openTeam} />}
                  {tab === 'region' && <RegionPanel board={totalBoard} rows={totalRows} provinces={provinces} province={search.province || ''} onProvince={(p) => setSearch({ province: p || undefined, team: undefined })} onSchool={(school) => { setQDraft(school); setSearch({ q: school, team: undefined }); }} />}
                  {tab === 'promo' && <PlayoffStandingPanel teams={teams} onOpen={openTeam} />}
                  {tab === 'timing' && <PlayoffTimingPanel teams={provinceRows} onOpen={openTeam} />}
                </div>
              </section>

              <aside className="space-y-4">
                <Sponsors />
                <ProvinceMap stats={provinces} province={search.province || ''} onPick={(p) => setSearch({ province: p === search.province ? undefined : p, team: undefined })} />
                <FeedPanel snap={snap} board={feedBoard} province={search.province || ''} onOpen={openTeam} />
              </aside>
            </div>

          </>
        )}
      </main>
      <Footer />
      <StarPrompt />
      {selectedTeam && <PlayoffTeamDialog team={selectedTeam} onClose={() => setSearch({ team: undefined })} />}
    </div>
  );
}
