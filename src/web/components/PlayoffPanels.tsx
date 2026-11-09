// 加赛专用分析面板：复用初赛的「晋级形势」「出分耗时与预测」位置，
// 加赛按前 50 名晋级，但官方不公开评测耗时，所以不能直接套初赛模型。
import { useMemo } from 'react';
import { fmtScore, fmtTime, timeAgo } from '../../shared/format.ts';
import { rowKey } from '../../shared/insights.ts';
import { filterByProvince, provinceLabel } from '../../shared/province.ts';
import type { Board, Row } from '../../shared/types.ts';
import { useNow } from '../lib/hooks.ts';
import { cx, Empty, Pill } from './ui.tsx';

const PROMOTION_LIMIT = 50;
const DISPLAY_LIMIT = 80;
const EPS = 1e-9;

function rankRows(rows: Row[]) {
  return [...rows].sort((a, b) => a.rank - b.rank || (b.score ?? -1) - (a.score ?? -1));
}

export function PlayoffStandingPanel({
  board,
  province,
  digits,
  onOpen,
}: {
  board: Board;
  province: string;
  digits: number;
  onOpen: (key: string) => void;
}) {
  const rows = board.rows;
  const sorted = useMemo(() => rankRows(rows), [rows]);
  const cutoff = sorted.length >= PROMOTION_LIMIT ? sorted[PROMOTION_LIMIT - 1] : null;
  const cutoffScore = cutoff?.score ?? null;
  const inCount = cutoffScore == null ? sorted.length : sorted.filter((r) => (r.score ?? -Infinity) >= cutoffScore - EPS).length;
  const near = useMemo(() => {
    const list = province ? filterByProvince(sorted, province) : sorted;
    return list.filter((r) => r.rank >= PROMOTION_LIMIT - 20 && r.rank <= PROMOTION_LIMIT + 20).slice(0, 50);
  }, [sorted, province]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="card-title">加赛晋级形势</h3>
        <Pill tone="amber">前 50 名晋级</Pill>
      </div>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        加赛按前 <b className="num">{PROMOTION_LIMIT}</b> 名晋级；官方榜单页面展示前 <b className="num">{DISPLAY_LIMIT}</b> 名（含并列）。这里用当前第{' '}
        {PROMOTION_LIMIT} 名的分数作为临时「晋级线」，随成绩刷新变化。{province && <> 省份筛选只影响下方列表，晋级线仍按全国榜计算。</>}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">第 {PROMOTION_LIMIT} 名分数</div>
          <div className="num mt-0.5 text-lg font-semibold">{fmtScore(cutoffScore, digits)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">晋级区队伍</div>
          <div className="num mt-0.5 text-lg font-semibold">{cutoffScore == null ? '—' : inCount}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">当前有成绩</div>
          <div className="num mt-0.5 text-lg font-semibold">{rows.length}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">省份</div>
          <div className="mt-0.5 truncate text-lg font-semibold">{province ? provinceLabel(province) : '全国'}</div>
        </div>
      </div>

      {cutoffScore == null ? (
        <Empty>当前榜只有 {rows.length} 支队伍，尚未形成第 {PROMOTION_LIMIT} 名晋级线；开赛后队伍增加会自动出现。</Empty>
      ) : near.length === 0 ? (
        <Empty>{province ? `${provinceLabel(province)}暂无接近晋级线的队伍` : '暂无接近晋级线的队伍'}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                <th className="px-3 py-2 font-medium">名次</th>
                <th className="px-3 py-2 font-medium">队伍</th>
                <th className="px-3 py-2 font-medium">学校</th>
                <th className="px-3 py-2 text-right font-medium">成绩</th>
                <th className="px-3 py-2 text-right font-medium">距晋级线</th>
              </tr>
            </thead>
            <tbody>
              {near.map((r) => {
                const gap = cutoffScore != null && r.score != null ? Math.max(0, cutoffScore - r.score) : null;
                const inZone = cutoffScore != null && (r.score ?? -Infinity) >= cutoffScore - EPS;
                return (
                  <tr
                    key={rowKey(r)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/60 dark:border-slate-800 dark:hover:bg-brand-500/10"
                    onClick={() => onOpen(rowKey(r))}
                  >
                    <td className="num px-3 py-2">No.{r.rank}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 font-medium">{r.name}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-slate-500">{r.school || '—'}</td>
                    <td className="num px-3 py-2 text-right">{fmtScore(r.score, digits)}</td>
                    <td className={cx('num px-3 py-2 text-right text-xs', inZone ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500')}>
                      {inZone ? '晋级区' : gap == null ? '—' : `差 ${fmtScore(gap, digits)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-slate-400">
        晋级线只是根据当前榜单做的产品分析，最终以官方规则为准；并列名次按官方榜单为准。
      </p>
    </div>
  );
}

export function PlayoffTimingPanel({
  board,
  digits,
  onOpen,
}: {
  board: Board;
  digits: number;
  onOpen: (key: string) => void;
}) {
  const now = useNow(30_000);
  const dated = useMemo(
    () => board.rows.filter((r): r is Row & { updated: string } => Boolean(r.updated)).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)),
    [board.rows],
  );
  const days = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dated) {
      const day = fmtTime(r.updated).slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);
  }, [dated]);
  const maxDay = Math.max(1, ...days.map(([, n]) => n));
  const latest = dated[0] ? Date.parse(dated[0].updated) : null;
  const earliest = dated.length ? Date.parse(dated[dated.length - 1]!.updated) : null;
  const spanDays = earliest != null && latest != null ? Math.max(1, Math.ceil((latest - earliest) / 86_400_000) + 1) : 0;
  const today = fmtTime(now).slice(0, 10);
  const todayCount = dated.filter((r) => fmtTime(r.updated).slice(0, 10) === today).length;

  if (!dated.length) return <Empty>加赛还没有成绩，暂时没有提交时间可看</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="card-title">成绩提交时间</h3>
        <Pill tone="amber">评测时间待核对</Pill>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        当前加赛榜单还是空的，公开接口尚未返回评测开始/完成时间；官方前端目前也只使用 <code>submittedAt</code>（成绩提交时间）。等开赛后拿到第一条原始 row，会核对完整字段；如果确实包含评测时间，再接真实耗时/ETA。下面先展示可用的提交时间分布。
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">有成绩队伍</div>
          <div className="num mt-0.5 text-lg font-semibold">{dated.length}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">提交日期跨度</div>
          <div className="num mt-0.5 text-lg font-semibold">{spanDays} 天</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">最近提交</div>
          <div className="mt-0.5 text-lg font-semibold">{latest == null ? '—' : timeAgo(latest, now)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">今日提交</div>
          <div className="num mt-0.5 text-lg font-semibold">{todayCount}</div>
        </div>
      </div>

      <section>
        <h4 className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">按成绩提交日统计（最近 14 天）</h4>
        <div className="flex h-36 items-stretch gap-1 rounded-lg bg-slate-50 px-3 pb-2 pt-3 dark:bg-slate-800/50">
          {days.map(([day, n]) => (
            <div key={day} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${day}：${n} 队`}>
              <span className="num text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">{n}</span>
              <div className="w-full rounded-t bg-brand-400/80 transition-colors group-hover:bg-brand-500" style={{ height: `${Math.max(4, (n / maxDay) * 72)}%` }} />
              <span className="hidden text-[10px] text-slate-400 sm:block">{day.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
              <th className="px-3 py-2 font-medium">名次</th>
              <th className="px-3 py-2 font-medium">队伍</th>
              <th className="px-3 py-2 text-right font-medium">成绩</th>
              <th className="px-3 py-2 text-right font-medium">成绩提交时间</th>
            </tr>
          </thead>
          <tbody>
            {dated.slice(0, 10).map((r) => (
              <tr
                key={rowKey(r)}
                className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/60 dark:border-slate-800 dark:hover:bg-brand-500/10"
                onClick={() => onOpen(rowKey(r))}
              >
                <td className="num px-3 py-2">No.{r.rank}</td>
                <td className="max-w-[14rem] truncate px-3 py-2 font-medium">{r.name}</td>
                <td className="num px-3 py-2 text-right">{fmtScore(r.score, digits)}</td>
                <td className="num px-3 py-2 text-right text-xs text-slate-500">{fmtTime(r.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
