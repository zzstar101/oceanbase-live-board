// 初赛榜 / 加赛榜共用的榜单视图。
// 页面只负责数据来源、标题和顶部说明；筛选、表格、分布、省份、关注、详情都在这里。
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { searchRows } from '../../shared/insights.ts';
import { filterByProvince, provinceStats } from '../../shared/province.ts';
import type { Board, Snapshot } from '../../shared/types.ts';
import type { Tab } from '../router.tsx';
import { BoardPicker } from './BoardPicker.tsx';
import { FeedPanel } from './FeedPanel.tsx';
import { FilterBar } from './FilterBar.tsx';
import { Kpis } from './Kpis.tsx';
import { LeaderTable } from './LeaderTable.tsx';
import { PromotionPanel } from './PromotionPanel.tsx';
import { ProvinceMap } from './ProvinceMap.tsx';
import { RegionPanel } from './RegionPanel.tsx';
import { ScoreDist } from './ScoreDist.tsx';
import { Sponsors } from './Sponsors.tsx';
import { StarBar } from './StarBar.tsx';
import { TeamDialog } from './TeamDialog.tsx';
import { TimingPanel } from './TimingPanel.tsx';
import { cx } from './ui.tsx';
import { hit } from '../lib/api.ts';

export interface LeaderboardSearch {
  province?: string;
  q?: string;
  tab?: Tab;
  team?: string;
}

export interface LeaderboardTab {
  id: Tab;
  label: string;
  show: boolean;
}

const defaultTabs = (board: Board): LeaderboardTab[] => [
  { id: 'rank', label: '排行榜', show: true },
  { id: 'dist', label: '分数分布', show: true },
  { id: 'region', label: '省份与学校', show: true },
  { id: 'promo', label: '晋级形势', show: true },
  { id: 'timing', label: '出分耗时与预测', show: board.kind === 'track' },
];

export function LeaderboardView({
  snap,
  boards,
  board,
  search,
  onSearch,
  onPickBoard,
  banner,
  kpis,
  tabs,
  csvHref,
  scoreDigits,
  scoreHeader,
  footerNote,
  totalLabel,
}: {
  snap: Snapshot;
  boards: Board[];
  board: Board;
  search: LeaderboardSearch;
  onSearch: (patch: Partial<LeaderboardSearch>, replace?: boolean) => void;
  onPickBoard: (id: string) => void;
  banner?: ReactNode;
  kpis?: ReactNode;
  tabs?: LeaderboardTab[];
  csvHref?: string;
  scoreDigits?: number;
  scoreHeader?: string;
  footerNote?: string;
  /** 总榜 chip 文案；加赛页用「加赛总榜」 */
  totalLabel?: string;
}) {
  const province = search.province || '';
  const allTabs = tabs ?? defaultTabs(board);
  const tab: Tab = allTabs.find((t) => t.id === search.tab && t.show)?.id ?? 'rank';
  const bodyRef = useRef<HTMLDivElement>(null);

  const provinceRows = useMemo(() => filterByProvince(board.rows, province), [board, province]);
  const shownRows = useMemo(() => searchRows(provinceRows, search.q), [provinceRows, search.q]);
  const provinces = useMemo(() => provinceStats(board.rows), [board]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [board.id, province, tab, search.q]);

  useEffect(() => {
    hit({ k: 'board', t: board.id });
  }, [board.id]);
  useEffect(() => {
    if (province) hit({ k: 'province', t: province });
  }, [province]);

  const openTeam = useCallback((key: string) => onSearch({ team: key }, false), [onSearch]);

  return (
    <>
      <StarBar snap={snap} onOpen={openTeam} />
      <BoardPicker boards={boards} current={board.id} province={province} onPick={onPickBoard} totalLabel={totalLabel} />
      {banner}
      {board.error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {board.stale ? '上游刷新失败，暂时显示上一次成功抓取的数据：' : '该榜单抓取失败：'}
          {board.error}
        </div>
      )}
      <FilterBar
        board={board}
        province={province}
        provinces={provinces}
        q={search.q || ''}
        shown={shownRows.length}
        onProvince={(p) => onSearch({ province: p || undefined })}
        onQuery={(q) => onSearch({ q: q || undefined })}
        csvHref={csvHref}
      />
      {kpis ?? <Kpis board={board} rows={provinceRows} province={province} snap={snap} />}

      {/* 宽屏：行高由右侧栏决定，左侧卡片拉伸到同样高度，内容在卡片内滚动（[contain:size] 让内容不参与撑高） */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
        <section className="card min-w-0 overflow-hidden lg:flex lg:min-h-[calc(100dvh-5rem)] lg:flex-col">
          <nav
            className="flex shrink-0 gap-5 overflow-x-auto border-b border-slate-200 px-4 pt-2 dark:border-slate-800"
            role="tablist"
            aria-label="视图"
          >
            {allTabs
              .filter((t) => t.show)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className="tab shrink-0"
                  onClick={() => onSearch({ tab: t.id === 'rank' ? undefined : t.id })}
                >
                  {t.label}
                </button>
              ))}
          </nav>
          <div
            ref={bodyRef}
            className={cx(
              'lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[contain:size]',
              tab === 'rank' ? '' : 'p-4',
            )}
          >
            {tab === 'rank' && (
              <LeaderTable
                board={board}
                rows={shownRows}
                province={province}
                query={search.q || ''}
                onOpen={openTeam}
                scoreDigits={scoreDigits}
                scoreHeader={scoreHeader}
                footerNote={footerNote}
              />
            )}
            {tab === 'dist' && <ScoreDist board={board} rows={provinceRows} province={province} onOpen={openTeam} />}
            {tab === 'region' && (
              <RegionPanel
                board={board}
                rows={provinceRows}
                provinces={provinces}
                province={province}
                onProvince={(p) => onSearch({ province: p || undefined })}
                onSchool={(s) => onSearch({ q: s, tab: undefined })}
              />
            )}
            {tab === 'promo' && <PromotionPanel snap={snap} province={province} onOpen={openTeam} />}
            {tab === 'timing' && board.kind === 'track' && <TimingPanel board={board} />}
          </div>
        </section>

        <aside className="space-y-4">
          <Sponsors />
          <ProvinceMap
            stats={provinces}
            province={province}
            onPick={(p) => onSearch({ province: p === province ? undefined : p || undefined })}
          />
          <FeedPanel snap={snap} board={board} province={province} onOpen={openTeam} />
        </aside>
      </div>

      {search.team && <TeamDialog snap={snap} teamKey={search.team} onClose={() => onSearch({ team: undefined })} />}
    </>
  );
}
