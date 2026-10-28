import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

// Small fixture reader for Netlify's canonical _headers artifact. This serves
// actual generated headers; it does not weaken CSP for the local test backend.
export async function serveSite(config) {
  const rules = [];
  for (const line of (await readFile('dist/_headers', 'utf8')).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
    else {
      const separator = line.indexOf(':');
      if (separator < 1 || !rules.length) throw Error('Unsupported _headers fixture format');
      rules.at(-1).headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  const root = resolve('dist');
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://local').pathname;
      for (const rule of rules) if (rule.path === '/*' || pathname === rule.path) {
        for (const [name, value] of Object.entries(rule.headers)) res.setHeader(name, value);
      }
      if (pathname === '/config.js' && config) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end('window.DAVID_CONFIG=' + JSON.stringify(config)); return;
      }
      const file = resolve(root, '.' + pathname.replace(/\/$/, '/index.html'));
      if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
      res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

export const fixtureSupabaseUrl = 'https://local-integration.supabase.co';
export async function routeStack(page, stack) {
  // All real cloud destinations are blocked. Only this fictitious hostname is
  // intercepted and forwarded to local disposable Auth/PostgREST.
  await page.route('https://**/*', route => route.abort());
  await page.route(fixtureSupabaseUrl + '/**', async route => {
    const original = new URL(route.request().url());
    try {
      const response = await route.fetch({ url: stack.url + original.pathname + original.search });
      await route.fulfill({ response });
    } catch (error) {
      // A reload or context teardown can cancel an in-flight catalog request.
      if (!page.isClosed() && !/has been disposed|Target.*closed|page.*closed/.test(error.message)) throw error;
    }
  });
}
