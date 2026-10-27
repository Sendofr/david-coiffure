import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './stack.mjs';

let stack, anonymous;
const accounts = {};
const clients = {};
const staffA = '10000000-0000-0000-0000-000000000001';
const staffB = '10000000-0000-0000-0000-000000000002';
const productId = '20000000-0000-0000-0000-000000000001';
const client = () => createClient(stack.url, stack.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const denied = result => { assert.ok(result.error, 'Expected operation denied'); };
const sale = () => ({ p_kind: 'producto', p_product_id: productId, p_service_id: null,
  p_sale_date: '2026-10-27', p_quantity: 1, p_unit_price_gs: 110000, p_unit_cost_gs: 1,
  p_payment_method: 'Efectivo', p_customer_name: 'Integración local', p_notes: '' });

before(async () => {
  stack = await startStack();
  anonymous = client();
  for (const role of ['owner', 'manager', 'stylist', 'unprofiled']) {
    const email = `${role}@test.invalid`, password = `Local-${randomBytes(20).toString('hex')}`;
    const response = await fetch(`${stack.url}/auth/v1/admin/users`, {
      method: 'POST', headers: { Authorization: `Bearer ${stack.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    assert.equal(response.status, 200, `Local Auth user creation failed (${role})`);
    const user = await response.json();
    assert.match(user.id, /^[a-f0-9-]{36}$/);
    accounts[role] = { email, password, id: user.id };
    clients[role] = client();
    ok(await clients[role].auth.signInWithPassword({ email, password }));
  }
  stack.sql(`insert into public.staff(id,name) values ('${staffA}','Profesional A'),('${staffB}','Profesional B');
    insert into public.profiles(id,display_name,role,staff_id) values
    ('${accounts.owner.id}','Propietario','owner',null),
    ('${accounts.manager.id}','Gerente','manager',null),
    ('${accounts.stylist.id}','Estilista','stylist','${staffA}');
    insert into public.services(name,active) values ('Servicio visible',true),('Servicio privado',false);
    insert into public.clients(name,phone) values ('Cliente privado','000000001');
    insert into public.appointments(client_name,client_phone,staff_id,appointment_date,start_time,end_time,status) values
    ('Asignado A','000000001','${staffA}','2026-10-28','10:00','11:00','confirmado'),
    ('Asignado B','000000002','${staffB}','2026-10-28','10:00','11:00','confirmado');
    insert into public.products(id,name,sku,category,cost_gs,sale_price_gs) values
    ('${productId}','Producto concurrente','LOCAL-CONCURRENT','Venta',65000,110000);`);
  ok(await clients.owner.rpc('record_stock_movement', { p_product_id: productId, p_delta_qty: 1, p_kind: 'entrada', p_note: 'Stock de prueba local' }));
}, { timeout: 180_000 });
after(async () => {
  for (const c of Object.values(clients)) await c.auth.signOut({ scope: 'local' });
  if (stack) await stack.close();
});

test('SDK oficial autentica usuarios reales en GoTrue y renueva la sesión', async () => {
  for (const role of ['owner', 'manager', 'stylist', 'unprofiled']) {
    const { user } = ok(await clients[role].auth.getUser());
    assert.equal(user.id, accounts[role].id);
  }
  const previous = ok(await clients.owner.auth.getSession()).session.refresh_token;
  const renewed = ok(await clients.owner.auth.refreshSession()).session;
  assert.ok(renewed.access_token);
  assert.notEqual(renewed.refresh_token, previous);
  const signup = await anonymous.auth.signUp({ email: 'self-register@test.invalid', password: `Local-${randomBytes(20).toString('hex')}` });
  denied(signup);
});

test('API anónima solo consulta servicios activos; no expone equipo ni administración', async () => {
  const services = ok(await anonymous.from('services').select('name'));
  assert.deepEqual(services.map(s => s.name), ['Servicio visible']);
  for (const table of ['profiles','staff','clients','appointments','products','stock_movements','sales','expenses']) {
    denied(await anonymous.from(table).select('*'));
  }
  denied(await anonymous.rpc('can_manage'));
  denied(await anonymous.rpc('register_sale', sale()));
});

test('usuario autenticado sin perfil no obtiene datos ni puede crear su propio rol', async () => {
  for (const table of ['profiles','staff','clients','appointments','products','stock_movements','sales','expenses']) {
    assert.deepEqual(ok(await clients.unprofiled.from(table).select('*')), [], table);
  }
  denied(await clients.unprofiled.from('profiles').insert({ id: accounts.unprofiled.id, role: 'owner' }));
  denied(await clients.unprofiled.from('clients').insert({ name: 'Intruso', phone: '000000000' }));
  denied(await clients.unprofiled.rpc('register_sale', sale()));
});

test('stylist ve únicamente su agenda y no accede a datos financieros ni escribe', async () => {
  const appointments = ok(await clients.stylist.from('appointments').select('client_name'));
  assert.deepEqual(appointments.map(a => a.client_name), ['Asignado A']);
  for (const table of ['clients','products','stock_movements','sales','expenses']) {
    assert.deepEqual(ok(await clients.stylist.from(table).select('*')), [], table);
  }
  denied(await clients.stylist.from('clients').insert({ name: 'No permitido', phone: '000000000' }));
  denied(await clients.stylist.from('appointments').insert({ client_name: 'No permitido', client_phone: '0', staff_id: staffA,
    appointment_date: '2026-10-29', start_time: '10:00', end_time: '11:00' }));
  denied(await clients.stylist.rpc('record_stock_movement', { p_product_id: productId, p_delta_qty: 1, p_kind: 'entrada' }));
  denied(await clients.stylist.rpc('register_sale', sale()));
  denied(await clients.stylist.from('profiles').update({ role: 'owner' }).eq('id', accounts.stylist.id));
});

test('owner y manager gestionan registros sin modificar stock o historial directamente', async () => {
  for (const role of ['owner', 'manager']) {
    assert.equal(ok(await clients[role].from('appointments').select('id')).length, 2);
    const created = ok(await clients[role].from('clients').insert({ name: `Prueba ${role}`, phone: '000000000' }).select().single());
    assert.equal(ok(await clients[role].from('clients').update({ notes: 'Persistido en PostgreSQL' }).eq('id', created.id).select().single()).notes, 'Persistido en PostgreSQL');
    denied(await clients[role].from('products').update({ stock_qty: 99 }).eq('id', productId));
    denied(await clients[role].from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000'));
    denied(await clients[role].from('stock_movements').delete().eq('product_id', productId));
    denied(await clients[role].from('profiles').update({ role: 'owner' }).eq('id', accounts.stylist.id));
  }
});

test('dos ventas REST concurrentes: una confirma, otra se rechaza sin stock negativo', async () => {
  const results = await Promise.all([clients.owner.rpc('register_sale', sale()), clients.manager.rpc('register_sale', sale())]);
  assert.equal(results.filter(r => !r.error).length, 1);
  assert.equal(results.filter(r => r.error?.code === '23514').length, 1);
  const product = ok(await clients.owner.from('products').select('stock_qty').eq('id', productId).single());
  assert.equal(product.stock_qty, 0);
  const sales = ok(await clients.owner.from('sales').select('*').eq('product_id', productId));
  assert.equal(sales.length, 1);
  assert.equal(sales[0].unit_cost_gs, 65000, 'Costo histórico proviene del inventario, no del navegador');
  assert.equal(sales[0].total_gs, 110000);
  assert.equal(sales[0].gross_profit_gs, 45000);
  const movements = ok(await clients.owner.from('stock_movements').select('*').eq('product_id', productId));
  assert.equal(movements.length, 2, 'Entrada y exactamente una venta');
  assert.equal(movements.reduce((n, m) => n + m.delta_qty, 0), 0);
});

test('revocar perfil bloquea una sesión JWT todavía vigente en PostgreSQL', async () => {
  stack.sql(`delete from public.profiles where id='${accounts.manager.id}'`);
  for (const table of ['clients','products','sales','expenses','appointments']) {
    assert.deepEqual(ok(await clients.manager.from(table).select('*')), [], table);
  }
  denied(await clients.manager.rpc('register_sale', sale()));
  denied(await clients.manager.rpc('record_stock_movement', { p_product_id: productId, p_delta_qty: 1, p_kind: 'entrada' }));
});

test('cerrar sesión invalida el refresh token de GoTrue', async () => {
  const refreshToken = ok(await clients.manager.auth.getSession()).session.refresh_token;
  ok(await clients.manager.auth.signOut());
  assert.equal(ok(await clients.manager.auth.getSession()).session, null);
  const separate = client();
  denied(await separate.auth.refreshSession({ refresh_token: refreshToken }));
});
