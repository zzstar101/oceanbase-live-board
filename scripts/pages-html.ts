/** Keep nested static entry assets relative to the same project root as index.html. */
export function renderPagesHtml(html: string, liveOrigin: string, depth = 0): string {
  const base = depth > 0 ? `<base href="${'../'.repeat(depth)}">` : '';
  const config = JSON.stringify({ mode: 'pages', liveOrigin }).replace(/</g, '\\u003c');
  return html.replace('<head>', `<head>${base}`).replace('</head>', `<script>window.__BOARD_CONFIG__=${config}</script></head>`);
}
