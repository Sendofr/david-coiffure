// End-to-end local agenda: browser -> official SDK -> Edge handler -> real PostgreSQL.
// Only the external Turnstile provider/widget is injected by this test runner.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './stack.mjs';
import { serveSite, fixtureSupabaseUrl, routeStack } from './static-site.mjs';
import { createBookingHandler } from '../../supabase/functions/booking/handler.mjs';

let stack, site, browser, edgeServer, edgeOrigin, browserNumber = 0, verifiedTokens = [];
const accounts = {}, clients = {};
const staffA = randomUUID(), staffB = randomUUID(), service = randomUUID(), product = randomUUID();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = n => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const allWeek = Array.from({ length: 7 }, (_, weekday) => [
  { weekday, start_time: '13:00', end_time: '15:00' }, { weekday, start_time: '15:30', end_time: '20:00' }
]).flat();

before(async () => {
  stack = await startStack({ agenda: true });
  for (const role of ['manager', 'stylist']) {
    const email = `agenda-browser-${role}@test.invalid`, password = 'Local-' + randomBytes(20).toString('hex');
    const response = await fetch(stack.url + '/auth/v1/admin/users', { method: 'POST',
      headers: { Authorization: 'Bearer ' + stack.serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }) });
    assert.equal(response.status, 200);
    const user = await response.json(); accounts[role] = { email, password, id: user.id };
    clients[role] = createClient(stack.url, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    ok(await clients[role].auth.signInWithPassword({ email, password }));
  }
  stack.sql(`insert into public.staff(id,name,active) values ('${staffA}','Profesional Browser A',true),('${staffB}','Profesional Browser B',true);
    insert into public.profiles(id,display_name,role,staff_id) values
    ('${accounts.manager.id}','Manager navegador','manager',null),('${accounts.stylist.id}','Stylist navegador','stylist','${staffA}');
    insert into public.services(id,name,duration_minutes,price_gs,active) values ('${service}','Servicio Browser 60',60,100000,true);
    insert into public.staff_booking_settings(staff_id,public_enabled) values ('${staffA}',true),('${staffB}',true);`);
  for (const id of [staffA, staffB]) ok(await clients.manager.rpc('replace_working_hours', { p_staff_id: id, p_intervals: allWeek }));
  ok(await clients.manager.from('appointments').insert([
    { client_name: 'Turno de Agenda A', client_phone: '+595985000001', staff_id: staffA, service_id: service, appointment_date: day(2), start_time: '13:00', end_time: '14:00', status: 'pendiente' },
    { client_name: 'Turno Carrera', client_phone: '+595985000003', staff_id: staffA, service_id: service, appointment_date: day(3), start_time: '13:00', end_time: '14:00', status: 'pendiente' },
    { client_name: 'Turno de Agenda B', client_phone: '+595985000002', staff_id: staffB, service_id: service, appointment_date: day(2), start_time: '16:00', end_time: '17:00', status: 'confirmado' }
  ]));
  ok(await clients.manager.from('products').insert({ id: product, name: 'Producto regresión agenda', sku: 'AGENDA-REGRESSION', category: 'Venta', cost_gs: 40000, sale_price_gs: 90000 }));
  ok(await clients.manager.rpc('record_stock_movement', { p_product_id: product, p_delta_qty: 2, p_kind: 'entrada', p_note: 'Fixture local' }));
  site = await serveSite({ mode: 'production', supabaseUrl: fixtureSupabaseUrl, supabasePublishableKey: stack.anonKey, bookingTurnstileSiteKey: 'local-public-widget-site-key' });
  const handler = createBookingHandler({ env: {
    SUPABASE_URL: stack.url, SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
    TURNSTILE_SECRET_KEY: randomBytes(24).toString('hex'), BOOKING_RATE_SECRET: randomBytes(32).toString('hex'), BOOKING_ALLOWED_ORIGINS: site.origin
  }, fetch: async (input, init) => {
    if (String(input) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const token = new URLSearchParams(init.body).get('response'); verifiedTokens.push(token);
      return Response.json({ success: /^local-browser-token-/.test(token || ''), hostname: new URL(site.origin).hostname, action: 'booking' });
    }
    return fetch(input, init);
  } });
  edgeServer = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
      const request = new Request('http://127.0.0.1/functions/v1/booking', { method: incoming.method, headers: incoming.headers,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500).end(); }
  });
  await new Promise(resolve => edgeServer.listen(0, '127.0.0.1', resolve)); edgeOrigin = 'http://127.0.0.1:' + edgeServer.address().port;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close(); await site?.close();
  if (edgeServer) await new Promise(resolve => edgeServer.close(resolve));
  for (const client of Object.values(clients)) await client.auth.signOut({ scope: 'local' });
  await stack?.close();
});

async function open(t, { width = 1440, lostResponse = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  const errors = [], calls = [], networkCalls = []; const number = ++browserNumber;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().startsWith(fixtureSupabaseUrl)) networkCalls.push(new URL(request.url()).pathname); });
  await routeStack(page, stack);
  await page.route(fixtureSupabaseUrl + '/functions/v1/booking', async route => {
    calls.push(route.request().postDataJSON());
    const response = await route.fetch({ url: edgeOrigin + '/functions/v1/booking', headers: { ...route.request().headers(), origin: site.origin, 'x-forwarded-for': '192.0.2.' + number } });
    if (lostResponse) assert.equal(response.status(), 200, 'The Edge handler must accept the request before a simulated lost response');
    if (lostResponse && calls.length === 1) return route.abort('connectionreset');
    await route.fulfill({ response });
  });
  await page.addInitScript(() => {
    window.cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    // A deterministic widget transport belongs to this test only; application code
    // still requires a token and the real handler validates it with its provider.
    let config, token = 0;
    const issue = () => queueMicrotask(() => config?.callback('local-browser-token-' + (++token)));
    window.turnstile = { render(_host, options) { config = options; issue(); return 1; }, reset() { issue(); }, remove() { config = null; } };
  });
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], 'No JavaScript errors during the scenario');
      assert.deepEqual(await page.evaluate(() => window.cspViolations), [], 'Real hosting CSP remains enforced');
    } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  });
  await page.goto(site.origin);
  await page.waitForFunction(() => document.querySelector('#booking-staff')?.options.length === 3);
  return { page, errors, calls, networkCalls };
}
async function selection(page, offset, name) {
  await page.locator('#booking-service').selectOption(service);
  await page.locator('#booking-staff').selectOption(staffA);
  await page.locator('#booking-date').fill(day(offset)); await page.locator('#booking-date').dispatchEvent('change');
  await page.waitForFunction(() => [...document.querySelector('#booking-time').options].some(option => option.value === '13:00'));
  await page.locator('#booking-time').selectOption('13:00');
  await page.locator('#booking-form [name="name"]').fill(name);
  await page.locator('#booking-form [name="phone"]').fill('+595985' + String(offset).padStart(6, '0'));
}
async function login(page, role, width = 1440) {
  await page.locator(width <= 760 ? '#mobile-quick-admin' : '#open-admin').click();
  await page.waitForFunction(() => document.querySelector('#login-form')?.offsetParent || document.querySelector('[data-page="appointments"]'));
  if (await page.locator('#login-form').isVisible()) {
    await page.locator('#field-email').fill(accounts[role].email); await page.locator('#field-password').fill(accounts[role].password);
    await page.locator('#login-form button[type="submit"]').click();
  }
  await page.locator('[data-page="appointments"]').waitFor();
  if (width <= 760) await page.locator('#mobile-admin-toggle').click();
  await page.locator('[data-page="appointments"]').click();
  await page.locator('.agenda-shell').waitFor();
}
async function agendaDate(page, date) { await page.locator('#agenda-date').fill(date); await page.locator('#agenda-date').dispatchEvent('change'); }
const noOverflow = async page => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page horizontal overflow');

for (const [index, width] of [360, 390, 768, 1440].entries()) {
  test(`reserva pública real local, recibo pendiente y acceso móvil a ${width}px`, async t => {
    const { page, calls, networkCalls } = await open(t, { width });
    await noOverflow(page);
    await page.locator(width <= 760 ? '.mobile-shortcut-book' : '.header-actions a').click();
    assert.equal(new URL(page.url()).hash, '#reservar');
    const name = ['Cliente Móvil Uno', 'Cliente Móvil Dos', 'Cliente Tablet', 'Cliente Escritorio'][index];
    await selection(page, 7 + index, name);
    if (width === 390) await page.screenshot({ path: '/tmp/david-booking-390.png', fullPage: true });
    await page.locator('#booking-form [type="submit"]').click();
    await page.locator('#booking-receipt').waitFor({ state: 'visible' });
    const receipt = await page.locator('#booking-receipt').textContent();
    assert.match(receipt, /Solicitud recibida · Pendiente/); assert.match(receipt, /salón debe confirmar/);
    assert.match(receipt, /America\/Asuncion/); assert.match(receipt, new RegExp(calls[0].request_id));
    const whatsapp = new URL(await page.locator('#booking-receipt a').getAttribute('href'));
    assert.match(whatsapp.searchParams.get('text'), /solicitud pendiente/);
    assert.match(whatsapp.searchParams.get('text'), /salón debe confirmar/);
    assert.equal(calls.length, 1); assert.equal(await page.locator('#booking-form [type="submit"]').isDisabled(), true);
    assert.equal(stack.sql(`select count(*) from public.appointments where client_name='${name}' and status='pendiente' and start_time='13:00' and end_time='14:00'`), '1');
    assert.equal(await page.evaluate(() => localStorage.getItem('david-coiffure-demo-v1')), null);
    assert.equal(networkCalls.some(path => /appointments|clients|profiles|staff$/.test(path)), false, 'Anonymous browser never reads private collections');
    await noOverflow(page);
    await login(page, 'manager', width); await agendaDate(page, day(7 + index));
    await page.locator('.agenda-card').filter({ hasText: name }).waitFor();
    if (width <= 760) {
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
      const cardBounds = await page.locator('.agenda-card').filter({ hasText: name }).boundingBox();
      assert.ok(cardBounds && cardBounds.x < width && cardBounds.x + cardBounds.width > 0, 'The selected day is scrolled into the mobile viewport');
    }
    if ([360, 1440].includes(width)) await page.screenshot({ path: '/tmp/david-agenda-' + width + '.png', fullPage: true });
    await noOverflow(page);
    await page.locator('[data-agenda-view="month"]').click(); assert.equal(await page.locator('.agenda-month-cell').count(), 42); await noOverflow(page);
    await page.locator('[data-agenda-action="schedule"]').click();
    await page.locator('#agenda-schedule-form').waitFor(); await noOverflow(page);
  });
}

test('respuesta perdida después del commit permite reintentar con UUID estable y CAPTCHA nuevo sin duplicar', async t => {
  const { page, calls } = await open(t, { lostResponse: true });
  await selection(page, 12, 'Cliente Reintento Seguro');
  await page.locator('#booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#booking-status').textContent.includes('Referencia de reintento:'));
  assert.equal(await page.locator('#booking-receipt').isVisible(), false);
  assert.equal(stack.sql("select count(*) from public.appointments where client_name='Cliente Reintento Seguro'"), '1');
  await login(page, 'manager'); await page.locator('#back-site').click();
  await page.waitForFunction(() => [...document.querySelector('#booking-time').options].some(option => option.textContent.includes('Recuperar solicitud')));
  assert.equal(await page.locator('#booking-time').inputValue(), '13:00', 'A refreshed catalog retains only the same uncertain request for recovery');
  await page.locator('#booking-form [type="submit"]').click(); await page.locator('#booking-receipt').waitFor({ state: 'visible' });
  assert.equal(calls.length, 2); assert.equal(calls[0].request_id, calls[1].request_id);
  assert.notEqual(calls[0].captcha_token, calls[1].captcha_token);
  for (const key of Object.keys(calls[0]).filter(key => key !== 'captcha_token')) assert.deepEqual(calls[0][key], calls[1][key]);
  assert.equal(stack.sql("select count(*) from public.appointments where client_name='Cliente Reintento Seguro'"), '1');
  assert.ok(verifiedTokens.includes(calls[0].captcha_token) && verifiedTokens.includes(calls[1].captcha_token));
});

test('calendario diario/semanal/mensual, filtro y estados persisten confirmación, reprogramación y cancelación', async t => {
  const { page } = await open(t); await login(page, 'manager'); await agendaDate(page, day(2));
  await page.locator('[data-agenda-view="day"]').click();
  assert.equal(await page.locator('.agenda-day-column').count(), 1); assert.equal(await page.locator('.agenda-card').count(), 2);
  await page.locator('#agenda-staff').selectOption(staffA); assert.equal(await page.locator('.agenda-card').count(), 1);
  let card = page.locator('.agenda-card').filter({ hasText: 'Turno de Agenda A' });
  await card.locator('[data-agenda-status="confirmado"]').click();
  await card.locator('[data-agenda-status="completado"]').waitFor();
  assert.equal(stack.sql("select status from public.appointments where client_name='Turno de Agenda A'"), 'confirmado');
  await card.locator('[data-agenda-edit]').click();
  await page.locator('#field-start_time').fill('16:00'); await page.locator('#edit-form [type="submit"]').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql("select start_time || '-' || end_time from public.appointments where client_name='Turno de Agenda A'"), '16:00:00-17:00:00');
  assert.match(await card.textContent(), /16:00–17:00/);
  await card.locator('[data-agenda-status="cancelado"]').click();
  await page.waitForFunction(() => document.querySelector('.agenda-card .status')?.textContent === 'Cancelado');
  assert.equal(stack.sql("select status from public.appointments where client_name='Turno de Agenda A'"), 'cancelado');
  await page.locator('#agenda-staff').selectOption(''); await page.locator('[data-agenda-view="week"]').click();
  assert.equal(await page.locator('.agenda-day-column').count(), 7);
  await page.locator('[data-agenda-view="month"]').click(); assert.equal(await page.locator('.agenda-month-cell').count(), 42);
  await page.locator('[data-agenda-action="next"]').click();
  assert.equal((await page.locator('#agenda-date').inputValue()).slice(0, 7) === day(2).slice(0, 7), false);
  await page.locator('[data-agenda-action="prev"]').click();
  assert.equal(await page.locator('#agenda-date').inputValue(), day(2));
  await page.locator(`[data-agenda-focus="${day(2)}"]`).click(); assert.equal(await page.locator('.agenda-day-column').count(), 1);
  card = page.locator('.agenda-card').filter({ hasText: 'Turno de Agenda B' }); await card.locator('[data-agenda-status="no-asistio"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.agenda-card .status')].some(el => el.textContent === 'No asistió'));
  assert.equal(stack.sql("select status from public.appointments where client_name='Turno de Agenda B'"), 'no-asistio');
  await page.reload(); await login(page, 'manager'); await agendaDate(page, day(2));
  assert.match(await page.locator('.agenda-shell').textContent(), /Cancelado/); assert.match(await page.locator('.agenda-shell').textContent(), /No asistió/);
});

test('editor guarda semana con descansos, publicación, excepción, vacaciones y cierre del salón', async t => {
  const { page } = await open(t); await login(page, 'manager');
  await page.locator('[data-agenda-action="schedule"]').click(); await page.locator('#agenda-schedule-form').waitFor();
  await page.locator('#agenda-schedule-staff').selectOption(staffB); await page.locator('#agenda-schedule-form').waitFor();
  await page.locator('#agenda-public-enabled').uncheck(); await page.locator('#agenda-public-form [type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#agenda-public-form [type="submit"]')?.disabled && !document.querySelector('#agenda-public-enabled')?.checked);
  assert.equal(stack.sql(`select public_enabled from public.staff_booking_settings where staff_id='${staffB}'`), 'f');
  await page.locator('#agenda-public-enabled').check(); await page.locator('#agenda-public-form [type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#agenda-public-form [type="submit"]')?.disabled && document.querySelector('#agenda-public-enabled')?.checked);
  await page.locator('#agenda-schedule-form [name="weekday-0"]').fill('13:00-15:00, 15:30-19:00');
  await page.locator('#agenda-schedule-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#agenda-schedule-form [name="weekday-0"]')?.value === '13:00-15:00, 15:30-19:00' && !document.querySelector('#agenda-schedule-form [type="submit"]')?.disabled);
  assert.equal(stack.sql(`select count(*) from public.staff_working_hours where staff_id='${staffB}' and weekday=0 and end_time='19:00'`), '1');
  const details = page.locator('.agenda-schedule details');
  await details.nth(1).locator('summary').click();
  await page.locator('#agenda-day-date').fill(day(40)); await page.locator('#agenda-day-closed').check();
  await page.locator('#agenda-day-form [type="submit"]').click();
  await page.locator(`[data-agenda-remove="exception"][data-date="${day(40)}"]`).waitFor({ state: 'attached' });
  assert.equal(stack.sql(`select count(*) from public.staff_schedule_exceptions where staff_id='${staffB}' and date='${day(40)}' and start_time is null`), '1');
  await details.nth(2).locator('summary').click();
  await page.locator('#agenda-timeoff-form [name="start_date"]').fill(day(41)); await page.locator('#agenda-timeoff-form [name="end_date"]').fill(day(42));
  await page.locator('#agenda-timeoff-form [name="reason"]').fill('Vacaciones locales'); await page.locator('#agenda-timeoff-form [type="submit"]').click();
  await page.locator('[data-agenda-remove="timeoff"]').waitFor({ state: 'attached' });
  assert.equal(stack.sql(`select count(*) from public.staff_time_off where staff_id='${staffB}' and start_date='${day(41)}' and end_date='${day(42)}'`), '1');
  await details.nth(3).locator('summary').click();
  await page.locator('#agenda-closure-form [name="start_date"]').fill(day(43)); await page.locator('#agenda-closure-form [name="end_date"]').fill(day(43));
  await page.locator('#agenda-closure-form [type="submit"]').click(); await page.locator('[data-agenda-remove="closure"]').waitFor({ state: 'attached' });
  assert.equal(stack.sql(`select count(*) from public.salon_closures where start_date='${day(43)}'`), '1');
  await page.locator('#modal-close').click();
  await page.reload(); await login(page, 'manager'); await page.locator('[data-agenda-action="schedule"]').click(); await page.locator('#agenda-schedule-form').waitFor();
  await page.locator('#agenda-schedule-staff').selectOption(staffB);
  await page.locator('[data-agenda-remove="timeoff"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#agenda-public-enabled').isChecked(), true);
});

test('stylist ve solamente su agenda y no recibe controles de edición ni colecciones privadas ajenas', async t => {
  const { page, networkCalls } = await open(t); await login(page, 'stylist'); await agendaDate(page, day(2));
  await page.locator('.agenda-card').filter({ hasText: 'Turno de Agenda A' }).waitFor();
  assert.doesNotMatch(await page.locator('.agenda-shell').textContent(), /Turno de Agenda B/);
  for (const selector of ['[data-agenda-action="schedule"]', '[data-agenda-action="new"]', '[data-agenda-edit]', '[data-agenda-status]']) assert.equal(await page.locator(selector).count(), 0, selector);
  assert.equal(await page.locator(`#agenda-staff option[value="${staffB}"]`).count(), 0);
  for (const forbidden of ['clients', 'products', 'sales', 'expenses', 'stock_movements']) assert.equal(networkCalls.includes('/rest/v1/' + forbidden), false, forbidden);
});


test('guardar durante una lectura vieja vuelve a consultar; un resultado tardío no revive acceso tras logout', { timeout: 45_000 }, async t => {
  const { page } = await open(t); await login(page, 'manager'); await agendaDate(page, day(3));
  let release, reached, reads = 0, captured = false;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reached = resolve; });
  t.after(() => release());
  await page.route(fixtureSupabaseUrl + '/rest/v1/appointments*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const query = new URL(route.request().url()).searchParams;
    if (query.get('select') === '*' && !query.has('id')) reads++;
    if (captured) return route.fallback();
    captured = true;
    const response = await route.fetch({ url: stack.url + new URL(route.request().url()).pathname + new URL(route.request().url()).search });
    reached(); await gate; await route.fulfill({ response });
  });
  await page.locator('[data-agenda-action="refresh"]').click(); await started;
  const updated = page.waitForResponse(response => response.url().includes('/rest/v1/appointments?') && response.request().method() === 'PATCH');
  await page.locator('.agenda-card').filter({ hasText: 'Turno Carrera' }).locator('[data-agenda-status="confirmado"]').click();
  assert.equal((await updated).status(), 204);
  release();
  await page.locator('.agenda-card').filter({ hasText: 'Turno Carrera' }).locator('[data-agenda-status="completado"]').waitFor();
  assert.ok(reads >= 2, 'A write during an old read queues a second authoritative fetch');
  assert.equal(stack.sql("select status from public.appointments where client_name='Turno Carrera'"), 'confirmado');
  await page.locator('.agenda-card').filter({ hasText: 'Turno Carrera' }).locator('[data-agenda-status="completado"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.agenda-card')].find(el => el.textContent.includes('Turno Carrera'))?.querySelector('.status')?.textContent === 'Completado');
  assert.equal(stack.sql("select status from public.appointments where client_name='Turno Carrera'"), 'completado');
  await page.unroute(fixtureSupabaseUrl + '/rest/v1/appointments*');
  let finish, pending, delivered; const settled = new Promise(resolve => { delivered = resolve; });
  const lateGate = new Promise(resolve => { finish = resolve; });
  const lateStarted = new Promise(resolve => { pending = resolve; });
  t.after(() => finish());
  await page.route(fixtureSupabaseUrl + '/rest/v1/appointments*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch({ url: stack.url + new URL(route.request().url()).pathname + new URL(route.request().url()).search });
    pending(); await lateGate;
    try { await route.fulfill({ response }); } catch (error) { if (!/closed|aborted|disposed/i.test(error.message)) throw error; } finally { delivered(); }
  });
  await page.locator('[data-agenda-action="refresh"]').click(); await lateStarted;
  await page.locator('#connection-button').click(); await page.locator('#login-logout').click(); await page.locator('#login-form').waitFor();
  finish(); await settled; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.agenda-card').count(), 0);
  assert.equal(await page.locator('[data-page="clients"]').count(), 0);
  assert.doesNotMatch(await page.locator('#admin-content').textContent(), /Turno Carrera/);
});

test('regresión Fase 1 con migración agenda: clientes, equipo, venta, stock e informe continúan persistiendo', async t => {
  const { page } = await open(t); await login(page, 'manager');
  await page.locator('[data-page="clients"]').click(); await page.locator('[data-action="new-clients"]').click();
  await page.locator('#field-name').fill('Cliente regresión fase dos'); await page.locator('#field-phone').fill('+595985333444');
  await page.locator('#edit-form [type="submit"]').click(); await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql("select count(*) from public.clients where name='Cliente regresión fase dos'"), '1');
  await page.locator('[data-page="staff"]').click(); await page.locator('[data-action="new-staff"]').click();
  await page.locator('#field-name').fill('Profesional privado regresión'); await page.locator('#field-active').selectOption('false');
  await page.locator('#edit-form [type="submit"]').click(); await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql("select count(*) from public.staff where name='Profesional privado regresión' and active=false"), '1');
  await page.locator('[data-page="sales"]').click(); await page.locator('[data-action="new-sale"]').click();
  await page.locator('#sale-form [type="submit"]').click(); await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql(`select stock_qty from public.products where id='${product}'`), '1.000');
  assert.equal(stack.sql(`select count(*) from public.sales where product_id='${product}' and total_gs=90000 and cost_total_gs=40000`), '1');
  await page.locator('[data-page="profits"]').click(); await page.locator('#admin-content .finance-total').waitFor();
  assert.match(await page.locator('#admin-content').textContent(), /90[.\s]?000/); assert.match(await page.locator('#admin-content').textContent(), /No equivale a utilidad contable/);
});


test('conflicto entre disponibilidad mostrada y envío rechaza la solicitud y ofrece consultar otro horario', async t => {
  const { page, calls } = await open(t); await selection(page, 20, 'Cliente Conflicto Visible');
  ok(await clients.manager.from('appointments').insert({ client_name: 'Turno ganado por otro cliente', client_phone: '+595985222999', staff_id: staffA, service_id: service, appointment_date: day(20), start_time: '13:00', end_time: '14:00', status: 'confirmado' }));
  await page.locator('#booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#booking-status')?.textContent.includes('El horario cambió'));
  assert.equal(calls.length, 1); assert.equal(await page.locator('#booking-receipt').isVisible(), false);
  assert.equal(stack.sql("select count(*) from public.appointments where client_name='Cliente Conflicto Visible'"), '0');
  assert.equal(await page.locator('#booking-time').inputValue(), '');
  assert.equal(await page.locator('#booking-time option[value="13:00"]').count(), 0);
  assert.equal(await page.locator('#booking-form [type="submit"]').isDisabled(), true);
});
