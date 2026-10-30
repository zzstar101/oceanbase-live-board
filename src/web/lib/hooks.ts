import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** 每 intervalMs 刷新一次的「现在」，用于「x 秒前」之类的相对时间 */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 浏览器原生 matchMedia，经 useSyncExternalStore 订阅（无撕裂、无多余渲染） */
export function useMedia(query: string) {
  const subscribe = useCallback(
    (fn: () => void) => {
      const m = matchMedia(query);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
}
