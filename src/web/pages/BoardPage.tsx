import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { provinceLabel } from '../../shared/province.ts';
import type { Board } from '../../shared/types.ts';
import { Footer } from '../components/Footer.tsx';
import { Header } from '../components/Header.tsx';
import { LeaderboardView } from '../components/LeaderboardView.tsx';
import { StarPrompt } from '../components/StarPrompt.tsx';
import { Card, Empty } from '../components/ui.tsx';
import { useLive } from '../lib/live.tsx';
import { boardRoute, type BoardSearch } from '../router.tsx';

export function BoardPage() {
  const search = boardRoute.useSearch();
  const navigate = useNavigate({ from: '/' });
  const { data, error } = useLive();
  const snap = data?.snap;

  const setSearch = useCallback(
    (patch: Partial<BoardSearch>, replace = true) => {
      void navigate({ search: (prev: BoardSearch) => ({ ...prev, ...patch }), replace });
    },
    [navigate],
  );

  const board: Board | undefined = useMemo(() => {
    if (!snap) return undefined;
    return snap.boards.find((b) => b.id === (search.board || 'total')) ?? snap.boards[0];
  }, [snap, search.board]);

  // React 19 原生文档元数据：<title> 写在组件里会被提升到 <head>
  const pageTitle = board
    ? `${board.title}${search.province ? ` · ${provinceLabel(search.province)}` : ''} - OceanBase 榜单实时看板`
    : 'OceanBase 榜单实时看板';

  return (
    <div className="flex min-h-dvh flex-col">
      <title>{pageTitle}</title>
      <Header />
      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        {!snap ? (
          <Card>
            {error ? (
              <Empty>
                <div className="text-rose-500">数据加载失败：{error.message}</div>
                <div className="mt-1">稍后会自动重试</div>
              </Empty>
            ) : (
              <LoadingSkeleton />
            )}
          </Card>
        ) : (
          board && (
            <LeaderboardView
              snap={snap}
              boards={snap.boards}
              board={board}
              search={search}
              onSearch={setSearch}
              onPickBoard={(id) => setSearch({ board: id === 'total' ? undefined : id, team: undefined }, false)}
            />
          )
        )}
      </main>
      <Footer />
      <StarPrompt />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3 py-4" aria-busy="true" aria-label="加载中">
      <div className="h-6 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-slate-100 dark:bg-slate-800/60" />
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-9 rounded bg-slate-100 dark:bg-slate-800/60" />
      ))}
      <p className="pt-2 text-center text-sm text-slate-400">正在从 OceanBase 拉取全部榜单（首次约需数秒）…</p>
    </div>
  );
}
