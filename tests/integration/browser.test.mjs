import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './stack.mjs';
import { serveSite, fixtureSupabaseUrl, routeStack } from './static-site.mjs';

let stack, server, browser, origin;
const accounts = {};
const staffA = '30000000-0000-0000-0000-000000000001';
const staffB = '30000000-0000-0000-0000-000000000002';
const productId = '40000000-0000-0000-0000-000000000001';
before(async () => {
  stack = await startStack();
  for (const role of ['owner', 'stylist', 'unprofiled']) {
    const email = `browser-${role}@test.invalid`, password = `Local-${randomBytes(20).toString('hex')}`;
    const response = await fetch(`${stack.url}/auth/v1/admin/users`, {
      method: 'POST', headers: { Authorization: `Bearer ${stack.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    assert.equal(response.status, 200, 'Local Auth user creation');
    const user = await response.json();
    assert.match(user.id, /^[a-f0-9-]{36}$/);
    accounts[role] = { email, password, id: user.id };
  }
  stack.sql(`insert into public.staff(id,name) values ('${staffA}','Profesional A'),('${staffB}','Profesional B');
    insert into public.profiles(id,display_name,role,staff_id) values
    ('${accounts.owner.id}','Propietario','owner',null),
    ('${accounts.stylist.id}','Estilista','stylist','${staffA}');
    insert into public.services(name,price_gs) values ('Servicio real local',100000);
    insert into public.appointments(client_name,client_phone,staff_id,appointment_date,start_time,end_time,status) values
    ('Cita asignada A','000000001','${staffA}','2026-10-28','10:00','11:00','confirmado'),
    ('Cita asignada B','000000002','${staffB}','2026-10-28','10:00','11:00','confirmado');
    insert into public.products(id,name,sku,category,cost_gs,sale_price_gs) values
    ('${productId}','Producto prueba navegador','BROWSER-LOCAL','Venta',65000,110000);`);
  const seedClient = createClient(stack.url, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.equal((await seedClient.auth.signInWithPassword(accounts.owner)).error, null);
  const seedResult = await seedClient.rpc('record_stock_movement', { p_product_id: productId, p_delta_qty: 2, p_kind: 'entrada', p_note: 'Datos ficticios locales de prueba' });
  assert.equal(seedResult.error, null, seedResult.error?.message);
  await seedClient.auth.signOut();
  server = await serveSite({ mode: 'production', supabaseUrl: fixtureSupabaseUrl, supabasePublishableKey: stack.anonKey });
  origin = server.origin;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
}, { timeout: 180_000 });
after(async () => {
  await browser?.close();
  if (server) await server.close();
  if (stack) await stack.close();
});
async function open(t, role) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await routeStack(page, stack);
  await page.addInitScript(() => {
    window.cspViolations=[];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
  });
  t.after(async () => { try { assert.deepEqual(await page.evaluate(() => window.cspViolations), []); } finally { if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' }); await context.close(); } });
  await page.goto(origin);
  await page.locator('#service-grid .service-tile').first().waitFor();
  assert.equal(await page.locator('#service-grid .service-tile').count(), 1, 'Public catalog fetched from PostgreSQL');
  await page.locator('#open-admin').click();
  assert.ok(!(await page.locator('#admin-content').textContent()).includes('Clienta de ejemplo'));
  await page.locator('#login-form').waitFor();
  await page.locator('#field-email').fill(accounts[role].email);
  await page.locator('#field-password').fill(accounts[role].password);
  await page.locator('#login-form button[type="submit"]').click();
  return { page, errors };
}

test('navegador en producción guarda cliente real local, recarga y cierra sesión sin demo', async t => {
  const { page, errors } = await open(t, 'owner');
  await page.locator('[data-page="clients"]').waitFor();
  await page.locator('[data-page="clients"]').click();
  await page.locator('[data-action="new-clients"]').click();
  await page.locator('#field-name').fill('Cliente creado en navegador');
  await page.locator('#field-phone').fill('000000009');
  await page.locator('#edit-form button[type="submit"]').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.ok((await page.locator('#admin-content').textContent()).includes('Cliente creado en navegador'));
  assert.equal(stack.sql("select count(*) from public.clients where name='Cliente creado en navegador'"), '1', 'Actually stored in database');
  assert.equal(await page.evaluate(() => localStorage.getItem('david-coiffure-demo-v1')), null);
  await page.reload();
  await page.locator('#open-admin').click();
  await page.locator('[data-page="clients"]').waitFor();
  await page.locator('[data-page="clients"]').click();
  assert.ok((await page.locator('#admin-content').textContent()).includes('Cliente creado en navegador'));
  await page.locator('[data-page="settings"]').click();
  await page.locator('[data-action="logout"]').click();
  await page.locator('#login-form').waitFor();
  assert.ok(!(await page.locator('#admin-content').textContent()).includes('Cliente creado en navegador'));
  await page.reload();
  await page.locator('#open-admin').click();
  await page.waitForFunction(() => /Iniciá sesión/.test(document.querySelector('#admin-content').textContent));
  assert.equal(await page.locator('[data-page="clients"]').count(), 0);
  assert.deepEqual(errors, []);
});

test('venta desde navegador usa RPC real, descuenta stock y actualiza resultado estimado', async t => {
  const { page, errors } = await open(t, 'owner');
  await page.locator('[data-page="sales"]').waitFor();
  await page.locator('[data-page="sales"]').click();
  await page.locator('[data-action="new-sale"]').click();
  await page.locator('#sale-form button[type="submit"]').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql(`select stock_qty from public.products where id='${productId}'`), '1.000');
  assert.equal(stack.sql(`select count(*) from public.sales where product_id='${productId}' and total_gs=110000 and cost_total_gs=65000`), '1');
  await page.locator('[data-page="profits"]').click();
  await page.locator('#admin-content .finance-total').waitFor();
  assert.match(await page.locator('#admin-content').textContent(), /110[.\s]?000/);
  assert.match(await page.locator('#admin-content').textContent(), /No equivale a utilidad contable/);
  assert.deepEqual(errors, []);
});

test('stylist en navegador solo recibe agenda asignada y no consulta finanzas', async t => {
  const { page, errors } = await open(t, 'stylist');
  await page.locator('[data-page="appointments"]').waitFor();
  await page.locator('[data-page="appointments"]').click();
  await page.locator('#admin-content tbody tr').filter({ hasText: 'Cita asignada A' }).waitFor();
  const content = await page.locator('#admin-content').textContent();
  assert.ok(content.includes('Cita asignada A'));
  assert.ok(!content.includes('Cita asignada B'));
  for (const name of ['clients','inventory','movements','sales','expenses','profits']) assert.equal(await page.locator(`[data-page="${name}"]`).count(), 0);
  assert.equal(await page.locator('[data-action="new-appointments"]').count(), 0);
  assert.deepEqual(errors, []);
});

test('cuenta sin perfil real permanece bloqueada en el navegador sin datos ficticios', async t => {
  const { page, errors } = await open(t, 'unprofiled');
  await page.waitForFunction(() => /no tiene un perfil autorizado/.test(document.querySelector('#admin-content').textContent));
  assert.equal(await page.locator('[data-page="clients"]').count(), 0);
  assert.ok(!(await page.locator('#admin-content').textContent()).includes('Clienta de ejemplo'));
  assert.equal(await page.evaluate(() => localStorage.getItem('david-coiffure-demo-v1')), null);
  assert.deepEqual(errors, []);
});

test('productos reales: SKU manual, edición, duplicado y generación opcional con CSP Netlify', async t => {
  const { page, errors } = await open(t, 'owner');
  await page.locator('[data-page="inventory"]').waitFor();
  await page.locator('[data-page="inventory"]').click();
  await page.locator('[data-action="new-products"]').click();
  await page.locator('#field-name').fill('Producto manual local');
  await page.locator('#field-sku').fill('manual-local-001');
  await page.locator('#field-category').selectOption('Venta');
  await page.locator('#field-cost_gs').fill('40000');
  await page.locator('#field-sale_price_gs').fill('80000');
  await page.locator('#edit-form button[type="submit"]').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql("select count(*) from public.products where sku='MANUAL-LOCAL-001' and stock_qty=0 and cost_gs=40000 and sale_price_gs=80000"), '1');
  const row = page.locator('#admin-content tbody tr').filter({ hasText: 'MANUAL-LOCAL-001' });
  await row.locator('[data-edit="products"]').click();
  await page.locator('#field-name').fill('Producto manual actualizado');
  await page.locator('#field-cost_gs').fill('45000');
  await page.locator('#edit-form button[type="submit"]').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql("select count(*) from public.products where sku='MANUAL-LOCAL-001' and name='Producto manual actualizado' and cost_gs=45000"), '1');
  await page.locator('[data-action="new-products"]').click();
  await page.locator('#field-name').fill('Duplicado bloqueado');
  await page.locator('#field-sku').fill('MANUAL-LOCAL-001');
  await page.locator('#field-cost_gs').fill('100');
  await page.locator('#edit-form button[type="submit"]').click();
  assert.match(await page.locator('#toast').textContent(), /código ya existe/);
  assert.equal(stack.sql("select count(*) from public.products where sku='MANUAL-LOCAL-001'"), '1');
  await page.locator('#generate-sku').click();
  const generated = await page.locator('#field-sku').inputValue();
  assert.match(generated, /^DAV-[A-Z2-9]{7}$/);
  await page.locator('#field-name').fill('Producto con SKU generado');
  await page.locator('#edit-form button[type="submit"]').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
  assert.equal(stack.sql("select count(*) from public.products where name='Producto con SKU generado' and sku like 'DAV-%' and stock_qty=0"), '1');
  await page.reload(); await page.locator('#open-admin').click();
  await page.locator('[data-page="inventory"]').waitFor(); await page.locator('[data-page="inventory"]').click();
  assert.ok((await page.locator('#admin-content').textContent()).includes(generated));
  assert.deepEqual(errors, []);
});
