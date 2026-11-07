import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './components/Markdown';

function html(text: string): string {
  return renderToStaticMarkup(createElement(Markdown, { text }));
}

describe('markdown', () => {
  it('renders inline code, fenced blocks, and lists without executing HTML', () => {
    const markup = html(
      'Use `<img src=x onerror="alert(1)">` safely.\n\n- one\n- <b>two</b>\n\n```js\n<script>alert(1)</script>\n```\n\n1. first',
    );
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<b>');
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).toContain('&lt;img');
    expect(markup).toContain('&lt;b&gt;two&lt;/b&gt;');
    expect(markup).toContain('<pre class="md-pre"><code>');
    expect(markup).toContain('<code class="md-inline">');
    expect(markup).toContain('<ul>');
    expect(markup).toContain('<ol>');
    expect(markup).toContain('<li>');
  });
});
