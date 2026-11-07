import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

/** Serve the built PWA. API and health routes are registered first and never fall through to the shell. */
export function mountWeb(app: Hono, webRoot: string): void {
  const abs = path.resolve(webRoot);
  const indexPath = path.join(abs, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`WEB_ROOT has no index.html (${abs})`);
  const indexHtml = readFileSync(indexPath, 'utf8');
  const root = path.relative(process.cwd(), abs) || '.';
  app.use('*', serveStatic({ root, index: 'index.html' }));
  app.get('*', (c) => {
    const pathname = c.req.path;
    if (pathname === '/healthz' || pathname === '/api' || pathname.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404);
    }
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}
