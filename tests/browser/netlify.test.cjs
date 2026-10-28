const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { chromium } = require('playwright');
let site, browser;
before(async () => {
  const { serveSite } = await import('../integration/static-site.mjs');
  site = await serveSite({ mode: 'demo', supabaseUrl: '', supabasePublishableKey: '' });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
});
after(async () => { await browser?.close(); await site?.close(); });

test('artefacto estático Netlify: build/publicación declarados, recursos200 y archivos privados404', async () => {
  const config = await readFile('netlify.toml', 'utf8');
  assert.match(config, /command\s*=\s*"npm run build && npm run build:config"/);
  assert.match(config, /publish\s*=\s*"dist"/);
  assert.match(config, /NODE_VERSION\s*=\s*"24"/);
  const root = await fetch(site.origin + '/');
  assert.equal(root.status, 200);
  assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(root.headers.get('x-frame-options'), 'DENY');
  assert.match(root.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(root.headers.get('content-security-policy'), /connect-src 'self' https:\/\/\*\.supabase\.co/);
  const markup = await root.text();
  const scripts = [...markup.matchAll(/<script\s+src="\.\/([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['config.js', 'vendor/supabase.js', 'auth.js', 'pagination.js', 'agenda.js', 'booking.js', 'app.js']);
  for (const resource of ['/', '/index.html', '/styles.css', '/agenda.css', '/booking.css', ...scripts.map(s => '/' + s)]) {
    const response = await fetch(site.origin + resource);
    assert.equal(response.status, 200, resource);
  }
  assert.equal((await fetch(site.origin + '/config.js')).headers.get('cache-control'), 'no-store');
  for (const path of ['/.env', '/.env.example', '/package.json', '/README.md', '/supabase/schema.sql', '/tests/integration/stack.mjs', '/docs/NETLIFY.md', '/ruta-inexistente']) {
    assert.equal((await fetch(site.origin + path)).status, 404, path + ' excluded from publish directory');
  }
});

for (const width of [360, 390, 768, 1440]) {
  test(`cabeceras Netlify reales permiten SDK, reserva y acceso equipo a ${width}px sin violar CSP`, async t => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    t.after(() => context.close());
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(() => {
      window.cspViolations=[];
      document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.origin);
    assert.equal(await page.evaluate(() => typeof supabase.createClient), 'function');
    assert.equal(await page.evaluate(() => typeof DavidAuth.resolveConfig), 'function');
    assert.equal(await page.evaluate(() => typeof DavidPagination.fetchAll), 'function');
    assert.equal(await page.evaluate(() => typeof DavidAgenda.create), 'function');
    assert.equal(await page.evaluate(() => typeof DavidBooking.init), 'function');
    assert.equal(await page.locator('#service-grid .service-tile').count(), 6);
    await page.locator(width <= 760 ? '.mobile-shortcut-book' : '.header-actions a').click();
    assert.equal(new URL(page.url()).hash, '#reservar');
    await page.locator('#booking-form').waitFor({ state: 'visible' });
    await page.locator(width <= 760 ? '#mobile-quick-admin' : '#open-admin').click();
    await page.locator('#admin-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#mode-label').textContent(), /DEMOSTRACIÓN/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.deepEqual(errors, []);
  });
}
