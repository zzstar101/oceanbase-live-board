import { describe, expect, test } from 'bun:test';
import { renderPagesHtml } from '../scripts/pages-html.ts';
import { resolvePagesBasepath } from '../src/web/lib/config.ts';

const source = '<html><head><script src="./app.js"></script><link href="./app.css"></head><body></body></html>';

describe('Pages static documentation entry', () => {
  test('root entry keeps relative assets and injects the live backend', () => {
    const html = renderPagesHtml(source, 'https://live.example');
    expect(html).not.toContain('<base');
    expect(html).toContain('"liveOrigin":"https://live.example"');
    expect(html).toContain('src="./app.js"');
  });
  test('nested entry resolves assets and router base against the project root', () => {
    const html = renderPagesHtml(source, 'https://live.example', 1);
    expect(html).toContain('<head><base href="../">');
    const pageUrl = 'https://user.github.io/project/mcp/';
    const documentBase = new URL('../', pageUrl).href;
    expect(new URL('./app.js', documentBase).href).toBe('https://user.github.io/project/app.js');
    expect(resolvePagesBasepath(pageUrl, documentBase)).toBe('/project');
    expect(resolvePagesBasepath('https://user.github.io/project/mcp')).toBe('/project');
    expect(resolvePagesBasepath('https://user.github.io/project/')).toBe('/project');
    expect(resolvePagesBasepath('https://user.github.io/', 'https://user.github.io/')).toBe('/');
  });
});
