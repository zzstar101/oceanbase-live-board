import { BASEPATH } from '../lib/config.ts';

/** Separate from live status so this entry stays visible on narrow screens. */
export function McpNavLink({ basepath = BASEPATH }: { basepath?: string }) {
  return (
    <a href={`${basepath.replace(/\/$/, '')}/mcp`} className="chip shrink-0 px-2.5 py-1 text-xs" aria-label="MCP 接入文档">
      <span className="font-mono text-brand-500 dark:text-brand-300" aria-hidden>↗</span>
      MCP
    </a>
  );
}
