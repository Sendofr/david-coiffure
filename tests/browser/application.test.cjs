const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');

let server, browser, origin;
before(async () => {
  const root = resolve('dist');
  server = createServer(async (req, res) => {
    try {
      const file = resolve(root, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
      if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
      const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true
  });
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });

async function open(t, { width = 1440, config, seed, api } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  // External photos/fonts are excluded from functional tests; the original URLs remain in source.
  await page.route('https://**/*', route => route.abort());
  if (config) await page.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript', body: 'window.DAVID_CONFIG=' + JSON.stringify(config)
  }));
  if (seed) await page.addInitScript(seed);
  if (api) await api(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  return { page, errors };
}
async function team(page, width = 1440) {
  await page.locator(width <= 760 ? '#mobile-quick-admin' : '#open-admin').click();
  await page.locator('#admin-view').waitFor({ state: 'visible' });
}

for (const width of [360, 390, 768, 1440]) {
  test(`public branding, booking and team access at ${width}px`, async t => {
    const { page, errors } = await open(t, { width });
    assert.equal(await page.locator('#service-grid .service-tile').count(), 6);
    assert.ok(await page.locator('.hero h1').isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'public horizontal overflow');
    const booking = page.locator(width <= 760 ? '.mobile-shortcut-book' : '.header-actions a');
    await booking.click();
    assert.equal(new URL(page.url()).hash, '#reservar');
    await page.locator('#booking-form').waitFor({ state: 'visible' });
    await team(page, width);
    assert.match(await page.locator('#mode-label').textContent(), /DEMOSTRACIÓN/);
    assert.match(await page.locator('#admin-content').textContent(), /fictici/i);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'admin horizontal overflow');
    assert.deepEqual(errors, []);
  });
}

test('demo CRUD persists only fictitious records and escapes HTML', async t => {
  const { page, errors } = await open(t);
  await team(page);
  await page.locator('[data-page="clients"]').click();
  await page.locator('[data-action="new-clients"]').click();
  const name = '<img src=x onerror=alert(1)>';
  await page.locator('#field-name').fill(name);
  await page.locator('#field-phone').fill('000000003');
  await page.locator('#edit-form button[type="submit"]').click();
  assert.ok((await page.locator('#admin-content').textContent()).includes(name));
  assert.equal(await page.locator('#admin-content img').count(), 0);
  await page.reload();
  await team(page);
  await page.locator('[data-page="clients"]').click();
  assert.ok((await page.locator('#admin-content').textContent()).includes(name));
  assert.deepEqual(errors, []);
});

test('demo records from before the finance module are preserved', async t => {
  const { page, errors } = await open(t, { seed: () => {
    localStorage.setItem('david-coiffure-demo-v1', JSON.stringify({
      services: [], staff: [], clients: [{ id: 'old', name: 'Older demo record', phone: '000' }],
      appointments: [], products: [], stock_movements: []
    }));
  } });
  await team(page);
  await page.locator('[data-page="clients"]').click();
  assert.match(await page.locator('#admin-content').textContent(), /Older demo record/);
  await page.locator('[data-page="sales"]').click();
  assert.match(await page.locator('#admin-content').textContent(), /No hay ventas registradas/);
  assert.deepEqual(errors, []);
});

test('demo product sale decreases stock and updates the estimated financial report', async t => {
  const { page, errors } = await open(t);
  await team(page);
  await page.locator('[data-page="sales"]').click();
  await page.locator('[data-action="new-sale"]').click();
  await page.locator('#sale-form button[type="submit"]').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('david-coiffure-demo-v1')));
  assert.equal(stored.products.find(p => p.id === 'pr3').stock_qty, 8);
  assert.equal(stored.sales.length, 3);
  assert.equal(stored.sales.at(-1).cost_total_gs, 65000);
  assert.equal(stored.stock_movements.at(-1).delta_qty, -1);
  await page.locator('[data-page="profits"]').click();
  assert.match(await page.locator('#admin-content').textContent(), /No equivale a utilidad contable/);
  assert.deepEqual(errors, []);
});

test('production without configuration fails closed even with stored demo data', async t => {
  const { page, errors } = await open(t, {
    config: { mode: 'production', supabaseUrl: '', supabasePublishableKey: '' },
    seed: () => {
      localStorage.setItem('david-coiffure-demo-v1', JSON.stringify({ clients: [{ name: 'DEMO MUST NOT LEAK' }] }));
      localStorage.setItem('david-auth-session', JSON.stringify({ access_token: 'legacy-token' }));
    }
  });
  await team(page);
  const text = await page.locator('#admin-content').textContent();
  assert.doesNotMatch(text, /DEMO MUST NOT LEAK|Clienta de ejemplo|Vista previa con información ficticia/);
  assert.equal(await page.locator('[data-action="new-clients"]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('david-auth-session')), null);
  assert.deepEqual(errors, []);
});

const production = {
  mode: 'production', supabaseUrl: 'https://test-project.supabase.co',
  supabasePublishableKey: 'sb_publishable_this_is_a_test_public_key'
};
test('production network outage never falls back to demonstration', async t => {
  const { page, errors } = await open(t, { config: production });
  await team(page);
  assert.doesNotMatch(await page.locator('#admin-content').textContent(), /Clienta de ejemplo|Profesional demo|Vista previa con información ficticia/);
  assert.equal(await page.locator('#admin-content [data-edit]').count(), 0);
  assert.deepEqual(errors, []);
});

// UI tests use controlled network responses through the REAL SDK bundle. Separate
// test:integration exercises real GoTrue, PostgREST and PostgreSQL permissions.
function mockBackend(role, { outageOnLogout = false } = {}) {
  const calls = [];
  const uid = '00000000-0000-0000-0000-000000000003';
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'team@example.invalid', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 }) + '.test';
  const api = async page => page.route('https://test-project.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    calls.push({ path: url.pathname, method: route.request().method() });
    const reply = body => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    if (url.pathname.endsWith('/token')) return reply({ access_token: token, token_type: 'bearer', refresh_token: 'test-refresh-token', expires_in: 3600, user });
    if (url.pathname.endsWith('/user')) return reply(user);
    if (url.pathname.endsWith('/logout')) {
      if (outageOnLogout) return route.abort();
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    const table = url.pathname.split('/').at(-1);
    const rows = {
      profiles: [{ id: uid, role, display_name: 'Test team', staff_id: uid }],
      services: [{ id: uid, name: 'Real catalog service', active: true, category: 'CORTE', duration_minutes: 60 }],
      staff: [{ id: uid, name: 'Real professional', active: true }],
      clients: [{ id: uid, name: 'PRIVATE OWNER CLIENT', phone: '000' }],
      appointments: [{ id: uid, staff_id: uid, client_name: 'Assigned appointment', client_phone: '000', appointment_date: '2099-01-01', start_time: '10:00', end_time: '11:00', status: 'pendiente' }]
    };
    return reply(rows[table] || []);
  });
  return { calls, api };
}
async function login(page) {
  await team(page);
  await page.locator('#login-form').waitFor({ state: 'visible' });
  await page.locator('#field-email').fill('team@example.invalid');
  await page.locator('#field-password').fill('test-password-not-a-real-account');
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#admin-content')?.textContent || '';
    return text.includes('Datos sincronizados') || text.includes('Mi agenda');
  });
}
test('stylist login requests only permitted collections and displays no demo or finances', async t => {
  const backend = mockBackend('stylist');
  const { page, errors } = await open(t, { config: production, api: backend.api });
  await login(page);
  for (const forbidden of ['clients', 'products', 'stock_movements', 'sales', 'expenses']) {
    assert.equal(backend.calls.some(c => c.path === '/rest/v1/' + forbidden), false, forbidden + ' should not be requested');
    assert.equal(await page.locator('[data-page="' + ({ products: 'inventory', stock_movements: 'movements' }[forbidden] || forbidden) + '"]').count(), 0);
  }
  assert.doesNotMatch(await page.locator('#admin-content').textContent(), /Clienta de ejemplo|Profesional demo|GANANCIA BRUTA/);
  assert.deepEqual(errors, []);
});
test('owner login, SDK session restoration, logout and offline logout clear private access', async t => {
  const backend = mockBackend('owner', { outageOnLogout: true });
  const { page, errors } = await open(t, { config: production, api: backend.api });
  await login(page);
  await page.locator('[data-page="clients"]').click();
  assert.match(await page.locator('#admin-content').textContent(), /PRIVATE OWNER CLIENT/);
  assert.equal(await page.evaluate(() => localStorage.getItem('david-auth-session')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('david-coiffure-demo-v1')), null);
  await page.reload();
  await team(page);
  await page.waitForFunction(() => document.querySelector('[data-page="clients"]'));
  await page.locator('[data-page="clients"]').click();
  assert.match(await page.locator('#admin-content').textContent(), /PRIVATE OWNER CLIENT/);
  await page.locator('[data-page="settings"]').click();
  await page.locator('[data-action="logout"]').click();
  await page.locator('#login-form').waitFor({ state: 'visible' });
  assert.doesNotMatch(await page.locator('#admin-content').textContent(), /PRIVATE OWNER CLIENT|Assigned appointment/);
  await page.reload();
  await team(page);
  await page.locator('#login-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-page="clients"]').count(), 0);
  assert.deepEqual(errors, []);
});
