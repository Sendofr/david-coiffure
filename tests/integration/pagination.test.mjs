import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { startStack } from './stack.mjs';
import { serveSite, fixtureSupabaseUrl, routeStack } from './static-site.mjs';
const { fetchAll } = createRequire(import.meta.url)('../../dist/pagination.js');

let stack, site, browser;
const accounts = {}, clients = {};
const count = 1505;
const product = '50000000-0000-0000-0000-000000000001';
const service = '50000000-0000-0000-0000-000000000002';
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const uuid = (prefix, index) => createHash('md5').update(prefix + index).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
const expectedIds = (prefix, n) => Array.from({ length: n }, (_, i) => uuid(prefix, i + 1)).sort();
const october = { month: '2026-10', salesCount: count, expensesCount: count, revenue: 1505000, directCosts: 602000,
  overhead: 150500, gross: 903000, balance: 752500 };

before(async () => {
  stack = await startStack();
  for (const role of ['owner','manager','stylist','unprofiled']) {
    const email = `large-${role}@test.invalid`, password = `Local-${randomBytes(20).toString('hex')}`;
    const response = await fetch(`${stack.url}/auth/v1/admin/users`, { method: 'POST',
      headers: { Authorization: `Bearer ${stack.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }) });
    assert.equal(response.status, 200, 'Disposable Auth account creation');
    const user = await response.json(); assert.match(user.id, /^[a-f0-9-]{36}$/);
    accounts[role] = { email, password, id: user.id };
    clients[role] = createClient(stack.url, stack.anonKey, options);
    ok(await clients[role].auth.signInWithPassword({ email, password }));
  }
  // Direct fixture inserts affect this isolated Docker database only. Historical
  // service sales intentionally have no inventory impact; stock movements are entries.
  stack.sql(`insert into public.profiles(id,display_name,role) values
    ('${accounts.owner.id}','Owner local','owner'),('${accounts.manager.id}','Manager local','manager'),
    ('${accounts.stylist.id}','Stylist local','stylist');
    insert into public.services(id,name,price_gs) values ('${service}','Servicio de ensayo masivo',1000);
    insert into public.products(id,name,sku,category,cost_gs) values ('${product}','Insumo de ensayo masivo','LARGE-LOCAL','Consumible',10);
    insert into public.clients(id,name,phone)
      select md5('large-client-'||i)::uuid,'Cliente local '||i,'000'||i from generate_series(1,${count}) i;
    insert into public.stock_movements(id,product_id,kind,delta_qty,note)
      select md5('large-movement-'||i)::uuid,'${product}','entrada',1,'Entrada local '||i from generate_series(1,${count}) i;
    update public.products set stock_qty=${count} where id='${product}';
    insert into public.sales(id,kind,service_id,sale_date,quantity,unit_price_gs,unit_cost_gs,payment_method)
      select md5('large-sale-'||i)::uuid,'servicio','${service}','2026-10-15',1,1000,400,'Efectivo' from generate_series(1,${count}) i;
    insert into public.expenses(id,expense_date,category,description,amount_gs)
      select md5('large-expense-'||i)::uuid,'2026-10-15','Operativo','Gasto local '||i,100 from generate_series(1,${count}) i;
    insert into public.sales(id,kind,service_id,sale_date,quantity,unit_price_gs,unit_cost_gs,payment_method)
      select md5('previous-sale-'||i)::uuid,'servicio','${service}','2026-09-30',1,2000,500,'Efectivo' from generate_series(1,17) i;
    insert into public.expenses(id,expense_date,category,description,amount_gs)
      select md5('previous-expense-'||i)::uuid,'2026-09-30','Operativo','Mes anterior '||i,200 from generate_series(1,17) i;
    insert into public.sales(id,kind,service_id,sale_date,quantity,unit_price_gs,unit_cost_gs,payment_method)
      select md5('next-sale-'||i)::uuid,'servicio','${service}','2026-11-01',1,9000,2000,'Efectivo' from generate_series(1,13) i;
    insert into public.expenses(id,expense_date,category,description,amount_gs)
      select md5('next-expense-'||i)::uuid,'2026-11-01','Operativo','Mes siguiente '||i,500 from generate_series(1,13) i;`);
  site = await serveSite({ mode: 'production', supabaseUrl: fixtureSupabaseUrl, supabasePublishableKey: stack.anonKey });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
}, { timeout: 180_000 });
after(async () => {
  await browser?.close(); await site?.close();
  for (const client of Object.values(clients)) await client.auth.signOut({ scope: 'local' });
  await stack?.close();
});

test('paginación real recupera todos los IDs sin duplicar con límite PostgREST de 1000', async () => {
  const truncated = ok(await clients.owner.from('clients').select('id'));
  assert.equal(truncated.length, 1000, 'Fixture must reproduce the actual default API cap');
  for (const [table, prefix, expected] of [
    ['clients','large-client-', count], ['stock_movements','large-movement-', count],
    ['sales','large-sale-', count + 30], ['expenses','large-expense-', count + 30]
  ]) {
    const rows = await fetchAll(clients.owner, table);
    assert.equal(rows.length, expected, table);
    assert.equal(new Set(rows.map(r => r.id)).size, expected, table + ' no duplicates');
    const required = new Set(expectedIds(prefix, count));
    for (const row of rows) required.delete(row.id);
    assert.equal(required.size, 0, table + ' no omitted rows');
    assert.deepEqual(rows.map(r => r.id), rows.map(r => r.id).sort(), table + ' deterministic unique order');
  }
});

test('agregación REST mensual usa todas las 1505 ventas y gastos y respeta límites de mes', async () => {
  for (const role of ['owner', 'manager']) {
    const result = ok(await clients[role].rpc('report_financials', { p_month: '2026-10-01' }));
    const { history, ...summary } = result;
    assert.deepEqual(summary, october);
    assert.equal(history.length, 6);
    assert.deepEqual(history.map(h => h.month), ['2026-05','2026-06','2026-07','2026-08','2026-09','2026-10']);
    assert.deepEqual(history.at(-1), october);
    assert.deepEqual(history.at(-2), { month: '2026-09', salesCount: 17, expensesCount: 17, revenue: 34000,
      directCosts: 8500, overhead: 3400, gross: 25500, balance: 22100 });
    assert.equal(history[0].revenue, 0);
  }
});

test('RPC financiera rechaza anónimo, stylist y usuario sin perfil incluso con datos masivos', async () => {
  const anonymous = createClient(stack.url, stack.anonKey, options);
  for (const client of [anonymous, clients.stylist, clients.unprofiled]) {
    const result = await client.rpc('report_financials', { p_month: '2026-10-01' });
    assert.ok(result.error); assert.equal(result.error.code, '42501');
  }
});

test('error real entre páginas rechaza la colección entera en lugar de entregar 1000 filas', async () => {
  let pages = 0;
  const session = ok(await clients.owner.auth.getSession()).session;
  const broken = createClient(stack.url, stack.anonKey, { ...options, global: {
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/rest/v1/clients' && init?.method !== 'HEAD' && ++pages >= 2) {
        return new Response(JSON.stringify({ message: 'Fallo de red controlado en segunda página' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return fetch(input, init);
    }
  } });
  ok(await broken.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }));
  await assert.rejects(() => fetchAll(broken, 'clients'));
  assert.ok(pages >= 2, 'The SDK may retry a failed GET; every retry must still fail closed');
  await broken.auth.signOut({ scope: 'local' });
});

test('panel real con CSP Netlify muestra 1505 filas mensuales y totales mensuales completos', async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await routeStack(page, stack);
  await page.addInitScript(() => {
    window.cspViolations=[];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
  });
  t.after(async () => { try { assert.deepEqual(await page.evaluate(() => window.cspViolations), []); } finally { if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' }); await context.close(); } });
  await page.goto(site.origin);
  await page.locator('#open-admin').click(); await page.locator('#login-form').waitFor();
  await page.locator('#field-email').fill(accounts.owner.email); await page.locator('#field-password').fill(accounts.owner.password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('[data-page="clients"]').waitFor(); await page.locator('[data-page="clients"]').click();
  assert.equal(await page.locator('#admin-content tbody tr').count(), count);
  await page.locator('[data-page="movements"]').click();
  assert.equal(await page.locator('#admin-content tbody tr').count(), count);
  await page.locator('[data-page="sales"]').click();
  await page.locator('#report-month').fill('2026-10');
  await page.locator('#report-month').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelectorAll('#admin-content tbody tr').length === 1505);
  await page.locator('[data-page="expenses"]').click();
  assert.equal(await page.locator('#admin-content tbody tr').count(), count);
  await page.locator('[data-page="profits"]').click();
  await page.waitForFunction(() => /1[.\s]?505[.\s]?000/.test(document.querySelector('#admin-content').textContent));
  const report = await page.locator('#admin-content').textContent();
  for (const number of ['1.505.000','602.000','150.500','903.000','752.500']) assert.ok(report.includes(number), `Missing exact total ${number}`);
  assert.match(report, /No equivale a utilidad contable/);
  assert.deepEqual(errors, []);
});
