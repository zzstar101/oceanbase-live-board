import type { ReactNode } from 'react';
import { fmtScore, fmtTime } from '../../shared/format.ts';
import { playoffTeamStarRow, type PlayoffTeamRow } from '../../shared/playoff.ts';
import { toggleStar, useStars } from '../lib/stars.ts';
import { Pill, RankBadge, StarButton } from './ui.tsx';

function Box({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

const score = (v: number | null, digits = 2) => (v == null ? '—' : fmtScore(v, digits));

/** 加赛专用详情：综合分 + 两个子题各自的名次/分数/排名分；不做无法验证的 ETA。 */
export function PlayoffTeamDialog({ team, onClose }: { team: PlayoffTeamRow | null; onClose: () => void }) {
  const { isStarred } = useStars();
  const starRow = team ? playoffTeamStarRow(team) : null;

  const open = (d: HTMLDialogElement | null) => {
    if (d && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
  };

  return (
    <dialog
      ref={open}
      closedby="any"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      className="m-auto w-[min(760px,calc(100vw-1.5rem))] max-h-[min(90dvh,820px)] rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px] dark:border-slate-700 dark:bg-[#0f141d] dark:text-slate-100"
      aria-label={team ? `${team.name} 详情` : '队伍详情'}
    >
      {!team ? (
        <div className="p-8 text-center text-slate-500">
          在当前数据里找不到这支队伍
          <div className="mt-4">
            <form method="dialog">
              <button className="btn">关闭</button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{team.name}</h2>
                <StarButton
                  on={starRow ? isStarred(starRow) : false}
                  onClick={() => starRow && toggleStar(starRow)}
                  label={team.name}
                />
              </div>
              <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {[team.school, team.province, team.advisor && `导师 ${team.advisor}`].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <form method="dialog" className="contents">
              <button data-autofocus className="btn px-2" aria-label="关闭">
                ✕
              </button>
            </form>
          </header>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {team.playoffScore == null && team.combinedRank == null && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                尚未提测，当前显示初赛分；提交后会自动补上性能、Prompt 与加赛综合分。
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Box label="综合名次" value={team.combinedRank == null ? '—' : <RankBadge rank={team.combinedRank} />} />
              <Box label="加赛综合分" value={score(team.playoffScore)} />
              <Box label="初赛分" value={score(team.preliminaryScore)} />
              <Box label="总分" value={score(team.totalScore)} sub="初赛分 + 加赛综合分" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">性能评测</h3>
                  <Pill>40 分</Pill>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><div className="text-xs text-slate-500">性能 E</div><div className="num font-semibold">{score(team.performance, 6)}</div></div>
                  <div><div className="text-xs text-slate-500">名次</div><div className="num font-semibold">{team.performanceRank == null ? '—' : `第 ${team.performanceRank} 名`}</div></div>
                  <div><div className="text-xs text-slate-500">排名分</div><div className="num font-semibold">{score(team.performancePoints, 1)}</div></div>
                </div>
              </section>

              <section className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-500/30 dark:bg-violet-500/5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Agent Prompt 评价</h3>
                  <Pill>40 分</Pill>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><div className="text-xs text-slate-500">原始分</div><div className="num font-semibold">{score(team.promptRawScore)}</div></div>
                  <div><div className="text-xs text-slate-500">名次</div><div className="num font-semibold">{team.promptRank == null ? '—' : `第 ${team.promptRank} 名`}</div></div>
                  <div><div className="text-xs text-slate-500">排名分</div><div className="num font-semibold">{score(team.promptPoints, 1)}</div></div>
                </div>
              </section>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="grid gap-2 sm:grid-cols-2">
                <div><span className="text-slate-500">成绩提交时间：</span>{team.submittedAt == null ? '—' : fmtTime(team.submittedAt)}</div>
                <div><span className="text-slate-500">成绩完成时间：</span>{team.evaluatedAt == null ? '暂无（等待上游返回评测完成时间）' : fmtTime(team.evaluatedAt)}</div>
              </div>
              <p className="mt-2 text-xs text-slate-400">只提测一次，两个子题使用同一次提交；性能或 Prompt 单项无效不会影响另一项。</p>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
