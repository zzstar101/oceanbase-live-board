// TanStack Router（代码式路由）：页面状态全部放在 URL 搜索参数里，可分享、可前进后退
import { createRootRoute, createRoute, createRouter, Outlet, useRouterState } from '@tanstack/react-router';
import type { PlayoffSort } from '../shared/playoff.ts';
import { BASEPATH } from './lib/config.ts';
import { BoardPage } from './pages/BoardPage.tsx';
import { PlayoffPage } from './pages/PlayoffPage.tsx';
import { StatsPage } from './pages/StatsPage.tsx';
import { McpPage } from './pages/McpPage.tsx';
import { LiveProvider } from './lib/live.tsx';

export const TABS = ['rank', 'dist', 'region', 'promo', 'timing'] as const;
export type Tab = (typeof TABS)[number];

export interface BoardSearch {
  /** 榜单 id：total | q600071 … */
  board?: string;
  /** 省份全称；'__none__' = 未填 */
  province?: string;
  /** 队伍 / 学校 / 导师搜索 */
  q?: string;
  tab?: Tab;
  /** 打开详情抽屉的队伍 rowKey */
  team?: string;
}

export interface PlayoffSearch {
  /** 排序维度：综合（默认）| 性能 | Prompt */
  sort?: Exclude<PlayoffSort, 'combined'>;
  /** 旧链接兼容；新页面用 sort */
  board?: 'performance' | 'prompt';
  province?: string;
  q?: string;
  tab?: Tab;
  /** 打开详情抽屉的队伍 key */
  team?: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);

function AppLayout() {
  const isMcp = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === '/mcp') });
  // Documentation must not open a snapshot query or WebSocket, including direct /mcp loads.
  return isMcp ? <Outlet /> : <LiveProvider><Outlet /></LiveProvider>;
}

const rootRoute = createRootRoute({ component: AppLayout });

export const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (s: Record<string, unknown>): BoardSearch => {
    const board = str(s.board);
    const tab = TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined;
    return {
      board: board && board !== 'total' ? board : undefined,
      province: str(s.province),
      q: str(s.q),
      tab: tab && tab !== 'rank' ? tab : undefined,
      team: str(s.team),
    };
  },
  component: BoardPage,
});

export const playoffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/playoff',
  validateSearch: (s: Record<string, unknown>): PlayoffSearch => {
    const playoffTabs = ['rank', 'dist', 'region', 'promo', 'timing'] as const;
    const tab = playoffTabs.includes(s.tab as (typeof playoffTabs)[number]) ? (s.tab as (typeof playoffTabs)[number]) : undefined;
    const sort = s.sort === 'performance' || s.sort === 'prompt' ? s.sort : s.board === 'performance' || s.board === 'prompt' ? s.board : undefined;
    return {
      sort,
      province: str(s.province),
      q: str(s.q),
      tab: tab && tab !== 'rank' ? tab : undefined,
      team: str(s.team),
    };
  },
  component: PlayoffPage,
});

export const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stats',
  component: StatsPage,
});

export const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mcp',
  component: McpPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([boardRoute, playoffRoute, statsRoute, mcpRoute]),
  basepath: BASEPATH,
  defaultPreload: false,
  scrollRestoration: true,
  defaultNotFoundComponent: () => (
    <div className="mx-auto max-w-md p-10 text-center text-slate-500">
      页面不存在，<a className="text-brand-600 underline" href={BASEPATH}>回到榜单</a>
    </div>
  ),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
