// 加赛单题页的分析面板：晋级固定按综合榜前 50；出分耗时只在 evaluatedAt 存在时计算。
import { useMemo } from 'react';
import { fmtDur, fmtScore, fmtTime } from '../../shared/format.ts';
import type { PlayoffTeamRow } from '../../shared/playoff.ts';
import { playoffSortRank, playoffSortScore } from '../../shared/playoff.ts';
import { Empty, Pill } from './ui.tsx';

export const PROMOTION_LIMIT = 50;
export const DISPLAY_LIMIT = 80;

const EPS = 1e-9;

export function PlayoffStandingPanel({
  teams,
  onOpen,
}: {
  teams: PlayoffTeamRow[];
  onOpen: (key: string) => void;
}) {
  const scored = useMemo(
    () => teams.filter((t) => t.combinedRank != null && t.totalScore != null).slice().sort((a, b) => a.combinedRank! - b.combinedRank! || b.totalScore! - a.totalScore!),
    [teams],
  );
  const cutoff = scored.length >= PROMOTION_LIMIT ? scored[PROMOTION_LIMIT - 1] : null;
  const cutoffScore = cutoff?.totalScore ?? null;
  const inCount = cutoffScore == null ? scored.length : scored.filter((t) => t.totalScore != null && t.totalScore >= cutoffScore - EPS).length;
  const near = scored
    .map((t, index) => ({ t, index }))
    .filter(({ index }) => index >= PROMOTION_LIMIT - 12 && index <= PROMOTION_LIMIT + 12);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="card-title">加赛晋级形势</h3>
        <Pill tone="amber">加赛前 {PROMOTION_LIMIT} 名晋级</Pill>
      </div>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        初赛前 50 名已直接晋级决赛，不参加加赛；加赛榜按总分取前 <b className="num">{PROMOTION_LIMIT}</b>{' '}
        名获得新增决赛名额。官方榜单页面展示前 <b className="num">{DISPLAY_LIMIT}</b> 名（含并列），这里用当前加赛榜第{' '}
        {PROMOTION_LIMIT} 名的总分作为临时晋级线，随成绩刷新变化。总分 = 初赛分 + 加赛综合分。
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">第 {PROMOTION_LIMIT} 名总分</div>
          <div className="num mt-0.5 text-lg font-semibold">{fmtScore(cutoffScore, 2)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">晋级区队伍</div>
          <div className="num mt-0.5 text-lg font-semibold">{cutoffScore == null ? '—' : inCount}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">当前有成绩</div>
          <div className="num mt-0.5 text-lg font-semibold">{scored.length}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">晋级线状态</div>
          <div className="mt-0.5 text-lg font-semibold">{cutoffScore == null ? '待形成' : '已形成'}</div>
        </div>
      </div>

      {cutoffScore == null ? (
        <Empty>当前榜只有 {scored.length} 支有综合成绩的队伍，尚未形成第 {PROMOTION_LIMIT} 名晋级线。</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                <th className="px-3 py-2 font-medium">综合名次</th>
                <th className="px-3 py-2 font-medium">队伍</th>
                <th className="px-3 py-2 font-medium">学校</th>
                <th className="px-3 py-2 text-right font-medium">总分</th>
                <th className="px-3 py-2 text-right font-medium">距晋级线</th>
                <th className="px-3 py-2 text-right font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {near.map(({ t, index }) => {
                const gap = t.totalScore == null || cutoffScore == null ? null : t.totalScore - cutoffScore;
                const qualified = index < PROMOTION_LIMIT;
                return (
                  <tr
                    key={t.key}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-brand-50/60 dark:border-slate-800 dark:hover:bg-brand-500/10"
                    onClick={() => onOpen(t.key)}
                  >
                    <td className="num px-3 py-2 font-medium">{t.combinedRank ?? index + 1}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 font-medium">{t.name}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-slate-500">{t.school || '—'}</td>
                    <td className="num px-3 py-2 text-right font-semibold">{fmtScore(t.totalScore, 2)}</td>
                    <td className="num px-3 py-2 text-right text-slate-500">{gap == null ? '—' : gap >= 0 ? `+${fmtScore(gap, 2)}` : fmtScore(gap, 2)}</td>
                    <td className="px-3 py-2 text-right">{qualified ? <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">晋级区</span> : <span className="text-xs text-slate-400">追赶中</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PlayoffTimingPanel({ teams, onOpen }: { teams: PlayoffTeamRow[]; onOpen: (key: string) => void }) {
  const submitted = useMemo(
    () => teams.filter((t) => t.submittedAt != null).slice().sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)),
    [teams],
  );
  const evaluated = submitted.filter((t) => t.evaluatedAt != null);
  const durations = evaluated
    .map((t) => Math.max(0, (t.evaluatedAt! - t.submittedAt!) / 1000))
    .sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const p90 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.9))] : null;
  const days = new Map<string, number>();
  for (const t of submitted) {
    const day = fmtTime(t.submittedAt!).slice(0, 5);
    days.set(day, (days.get(day) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="card-title">出分耗时与提交分布</h3>
        <Pill tone={evaluated.length ? 'green' : 'amber'}>{evaluated.length ? '含成绩完成时间' : '评测时间待核对'}</Pill>
      </div>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {evaluated.length
          ? '上游返回了成绩完成时间，下面的耗时按「成绩完成时间 − 提交时间」计算；样本只包含当前已加载且两项时间都存在的队伍。'
          : '上游公开榜目前只返回成绩提交时间，没有评测开始/完成时间（任务记录接口需要登录）；因此暂时无法可靠计算提交→出分耗时或预计出分。这里只展示提交时间分布，拿到新字段后会自动切换到真实耗时。'}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">可计算耗时样本</div>
          <div className="num mt-0.5 text-lg font-semibold">{evaluated.length}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">中位耗时</div>
          <div className="num mt-0.5 text-lg font-semibold">{median == null ? '—' : fmtDur(median)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">P90 耗时</div>
          <div className="num mt-0.5 text-lg font-semibold">{p90 == null ? '—' : fmtDur(p90)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500 dark:text-slate-400">最近提交</div>
          <div className="mt-0.5 truncate text-lg font-semibold">{submitted[0] ? fmtTime(submitted[0].submittedAt!) : '—'}</div>
        </div>
      </div>

      <div>
        <h4 className="card-title mb-2">按日提交分布</h4>
        {days.size ? (
          <div className="flex flex-wrap gap-2">
            {[...days.entries()].map(([day, n]) => (
              <span key={day} className="badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {day} · {n} 队
              </span>
            ))}
          </div>
        ) : (
          <Empty>暂无提交记录</Empty>
        )}
      </div>

      <div>
        <h4 className="card-title mb-2">最近提交</h4>
        {submitted.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {submitted.slice(0, 12).map((t) => (
              <li key={t.key}>
                <button type="button" className="flex w-full items-center gap-3 py-2 text-left text-sm hover:text-brand-600" onClick={() => onOpen(t.key)}>
                  <span className="num w-12 text-xs text-slate-400">#{playoffSortRank(t, 'combined') ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                  <span className="num text-xs text-slate-500">{fmtTime(t.submittedAt!)}</span>
                  <span className="num w-16 text-right text-xs text-slate-500">{fmtScore(playoffSortScore(t, 'combined'), 2)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>暂无提交记录</Empty>
        )}
      </div>
    </div>
  );
}
