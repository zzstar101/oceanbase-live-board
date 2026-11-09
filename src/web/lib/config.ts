// 运行模式：
//   server —— 由 Bun 本地服务或 Cloudflare Worker 同源提供（/api/*、/api/stream 可用）
//   pages  —— GitHub Pages 静态托管：先连 LIVE_ORIGIN 的 Worker，失败再读 ./data/snapshot.json
declare global {
  interface Window {
    __BOARD_CONFIG__?: { mode?: 'pages'; liveOrigin?: string };
  }
}

const injected = typeof window !== 'undefined' ? window.__BOARD_CONFIG__ : undefined;

export const MODE: 'server' | 'pages' = injected?.mode === 'pages' ? 'pages' : 'server';
export const LIVE_ORIGIN = (injected?.liveOrigin || 'https://board.nerv-base.com').replace(/\/$/, '');
/** API 前缀：同源时为空串 */
export const API_BASE = MODE === 'pages' ? LIVE_ORIGIN : '';

const host = typeof location !== 'undefined' ? location.hostname : '';
export const IS_LOCAL = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');

/** Nested static entries declare a <base> so assets and routes share the project root. */
export function resolvePagesBasepath(pageHref: string, documentBaseURI = pageHref): string {
  return new URL('.', documentBaseURI).pathname.replace(/\/$/, '') || '/';
}

export const BASEPATH =
  typeof location !== 'undefined' && MODE === 'pages'
    ? resolvePagesBasepath(location.href, typeof document !== 'undefined' ? document.baseURI : location.href)
    : '/';

/** 静态快照地址（相对页面所在目录） */
export const STATIC_SNAPSHOT_URL = MODE === 'pages' ? `${BASEPATH.replace(/\/$/, '')}/data/snapshot.json` : '';
