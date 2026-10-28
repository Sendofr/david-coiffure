const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

function netlifyHeaders() {
  const routes = [];
  for (const line of readFileSync('dist/_headers', 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) routes.push({ source: line === '/*' ? '/(.*)' : line, headers: [] });
    else {
      const colon = line.indexOf(':');
      assert.ok(colon > 0, 'Expected a valid Netlify header');
      routes.at(-1).headers.push({ key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
    }
  }
  return routes;
}

test('Vercel static preview mirrors canonical Netlify security headers without fallback routes', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(vercel.framework, null);
  assert.equal(vercel.installCommand, 'npm ci');
  assert.equal(vercel.buildCommand, 'npm run build && npm run build:config');
  assert.equal(vercel.outputDirectory, 'dist');
  assert.equal(vercel.rewrites, undefined, 'Unknown routes must not be disguised as index.html');
  assert.equal(vercel.routes, undefined);
  assert.deepEqual(vercel.headers, netlifyHeaders(), 'Update both hosts when changing canonical dist/_headers');
});

test('booking CSP permits the Turnstile widget while administrative secrets and loopback remain excluded', () => {
  const headers = netlifyHeaders()[0].headers;
  const policy = headers.find(h => h.key === 'Content-Security-Policy').value;
  const directive = name => policy.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' '));
  assert.equal(directive('script-src'), "script-src 'self' https://challenges.cloudflare.com");
  assert.equal(directive('frame-src'), 'frame-src https://challenges.cloudflare.com');
  assert.equal(directive('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(directive('connect-src'), "connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com");
  assert.equal(directive('object-src'), "object-src 'none'");
  assert.doesNotMatch(policy, /unsafe-eval|localhost|127\.0\.0\.1|http:/);
  assert.ok(!headers.some(h => /access-control-allow-origin/i.test(h.key)), 'Edge CORS must be configured explicitly, not opened globally');
});
