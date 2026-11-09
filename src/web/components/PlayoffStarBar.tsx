import { fmtScore } from '../../shared/format.ts';
import type { PlayoffTeamRow } from '../../shared/playoff.ts';
import { unstar, useStars } from '../lib/stars.ts';

/** 加赛单题页的关注条：同一行同时展示综合、性能、Prompt 三项摘要。 */
export function PlayoffStarBar({
  teams,
  onOpen,
}: {
  teams: PlayoffTeamRow[];
  onOpen: (key: string) => void;
}) {
  const { stars } = useStars();
  const watched = stars
    .map((s) => teams.find((t) => t.key === s.key))
    .filter((t): t is PlayoffTeamRow => Boolean(t));

  if (!watched.length) return null;

  return (
    <section className="card px-4 py-3" aria-label="我关注的队伍">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="card-title">★ 我关注的队伍</h2>
        <span className="text-xs text-slate-400">保存在本机浏览器</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {watched.map((t) => (
          <div
            key={t.key}
            className="group relative w-[19rem] shrink-0 cursor-pointer rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 hover:border-amber-300 dark:border-amber-400/30 dark:bg-amber-400/5"
            onClick={() => onOpen(t.key)}
          >
            <button
              type="button"
              className="absolute top-1.5 right-2 text-xs text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-500"
              onClick={(e) => {
                e.stopPropagation();
                unstar(t.key);
              }}
              title="取消关注"
            >
              ✕
            </button>
            <div className="truncate pr-4 text-sm font-semibold">{t.name}</div>
            <div className="truncate text-xs text-slate-500">{[t.school, t.province].filter(Boolean).join(' · ') || '—'}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span><span className="text-slate-500">综合 </span><b className="num">{t.combinedRank == null ? '—' : `#${t.combinedRank}`}</b><span className="num ml-1">{fmtScore(t.totalScore, 2)}</span></span>
              <span><span className="text-slate-500">性能 </span><b className="num">{t.performanceRank == null ? '—' : `#${t.performanceRank}`}</b></span>
              <span><span className="text-slate-500">Prompt </span><b className="num">{t.promptRank == null ? '—' : `#${t.promptRank}`}</b></span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
