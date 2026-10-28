import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './stack.mjs';
import { serveSite, fixtureSupabaseUrl } from './static-site.mjs';
import { createBookingHandler } from '../../supabase/functions/booking/handler.mjs';

let stack, site, edgeServer, edgeOrigin, verifyCount = 0, sequence = 0;
const accounts = {}, clients = {};
const staffA = randomUUID(), staffB = randomUUID(), staffInactive = randomUUID(), staffPrivate = randomUUID();
const service60 = randomUUID(), service120 = randomUUID(), serviceInactive = randomUUID();
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const businessToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = offset => { const date = new Date(businessToday + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
const dates = Array.from({ length: 45 }, (_, i) => addDays(i + 7));
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const denied = result => assert.ok(result.error, 'Expected the operation to be rejected');
const hash = text => createHash('sha256').update(text).digest('hex');
function bookingArgs(values = {}) {
  sequence++;
  const id = values.id || randomUUID(), phone = values.phone || '+5959' + String(sequence).padStart(8, '0');
  return { p_request_id: id, p_name: values.name || 'Cliente Agenda ' + sequence, p_phone: phone,
    p_service_id: values.service || service60, p_staff_id: values.staff || staffA,
    p_date: values.date || dates[5], p_time: values.time || '13:00',
    p_ip_hash: values.ipHash || hash('local-ip-' + id), p_phone_hash: hash(phone) };
}
const slots = (date, service = service60, staff = staffA) => clients.anon.rpc('available_slots', { p_staff_id: staff, p_service_id: service, p_date: date });
const appointment = async name => ok(await clients.manager.from('appointments').select('*').eq('client_name', name).single());
const teamAppointment = (date, extra = {}) => ({ client_name: 'Cliente de equipo', client_phone: '+595985000001', staff_id: staffA,
  service_id: service60, appointment_date: date, start_time: '13:00', end_time: '13:05', status: 'confirmado', ...extra });

before(async () => {
  stack = await startStack({ agenda: true });
  clients.anon = createClient(stack.url, stack.anonKey, options);
  clients.gateway = createClient(stack.url, stack.serviceKey, options);
  for (const role of ['owner','manager','stylist','unprofiled']) {
    const email = `agenda-${role}@test.invalid`, password = `Local-${randomBytes(20).toString('hex')}`;
    const response = await fetch(`${stack.url}/auth/v1/admin/users`, { method: 'POST',
      headers: { Authorization: `Bearer ${stack.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }) });
    assert.equal(response.status, 200, 'Disposable Auth account creation');
    const user = await response.json(); assert.match(user.id, /^[a-f0-9-]{36}$/);
    accounts[role] = { email, password, id: user.id };
    clients[role] = createClient(stack.url, stack.anonKey, options);
    ok(await clients[role].auth.signInWithPassword({ email, password }));
  }
  stack.sql(`insert into public.staff(id,name,active) values
    ('${staffA}','Profesional Agenda A',true),('${staffB}','Profesional Agenda B',true),
    ('${staffInactive}','Profesional inactivo',false),('${staffPrivate}','Profesional privado',true);
    insert into public.profiles(id,display_name,role,staff_id) values
    ('${accounts.owner.id}','Owner local','owner',null),('${accounts.manager.id}','Manager local','manager',null),
    ('${accounts.stylist.id}','Stylist local','stylist','${staffA}');
    insert into public.services(id,name,duration_minutes,active) values
    ('${service60}','Servicio sesenta minutos',60,true),('${service120}','Servicio ciento veinte minutos',120,true),
    ('${serviceInactive}','Servicio inactivo',30,false);
    insert into public.staff_booking_settings(staff_id,public_enabled) values
    ('${staffA}',true),('${staffB}',true),('${staffInactive}',true),('${staffPrivate}',false);`);
  const hours = Array.from({ length: 7 }, (_, weekday) => [
    { weekday, start_time: '13:00', end_time: '15:00' }, { weekday, start_time: '15:30', end_time: '20:00' }
  ]).flat();
  for (const staff of [staffA, staffB, staffPrivate]) ok(await clients.manager.rpc('replace_working_hours', { p_staff_id: staff, p_intervals: hours }));
  ok(await clients.manager.rpc('replace_schedule_day', { p_staff_id: staffA, p_date: dates[1], p_intervals: [] }));
  ok(await clients.manager.rpc('replace_schedule_day', { p_staff_id: staffA, p_date: dates[4], p_intervals: [{ start_time: '10:00', end_time: '12:00' }] }));
  ok(await clients.manager.from('staff_time_off').insert({ staff_id: staffA, start_date: dates[2], end_date: dates[2], reason: 'Vacación local de ensayo' }));
  ok(await clients.manager.from('salon_closures').insert({ start_date: dates[3], end_date: dates[3], reason: 'Cierre local de ensayo' }));
  site = await serveSite({ mode: 'production', supabaseUrl: fixtureSupabaseUrl, supabasePublishableKey: stack.anonKey,
    bookingTurnstileSiteKey: '1x00000000000000000000AA' });
  const handler = createBookingHandler({ env: { SUPABASE_URL: stack.url, SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
    TURNSTILE_SECRET_KEY: randomBytes(24).toString('hex'), BOOKING_RATE_SECRET: randomBytes(32).toString('hex'), BOOKING_ALLOWED_ORIGINS: site.origin },
    fetch: async (input, init) => {
      if (String(input) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        verifyCount++;
        const token = new URLSearchParams(init.body).get('response');
        return Response.json({ success: token?.startsWith('local-widget-token-') === true, hostname: new URL(site.origin).hostname, action: 'booking' });
      }
      return fetch(input, init);
    }
  });
  edgeServer = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
      const headers = new Headers(incoming.headers); headers.set('x-forwarded-for', '192.0.2.100');
      const request = new Request('http://127.0.0.1/functions/v1/booking', { method: incoming.method, headers,
        ...(['GET','HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500).end(); }
  });
  await new Promise(resolve => edgeServer.listen(0, '127.0.0.1', resolve));
  edgeOrigin = 'http://127.0.0.1:' + edgeServer.address().port;
}, { timeout: 180_000 });
after(async () => {
  await site?.close();
  if (edgeServer) await new Promise(resolve => edgeServer.close(resolve));
  for (const role of ['owner','manager','stylist','unprofiled']) await clients[role]?.auth.signOut({ scope: 'local' });
  await stack?.close();
});

test('catálogo público requiere publicación explícita y no expone PII, horarios internos ni auditoría', async () => {
  const catalog = ok(await clients.anon.rpc('booking_catalog'));
  assert.deepEqual(catalog.map(row => row.id).sort(), [staffA, staffB].sort());
  for (const row of catalog) assert.deepEqual(Object.keys(row).sort(), ['id','name']);
  for (const table of ['staff','appointments','appointment_events','staff_booking_settings','staff_working_hours','staff_schedule_exceptions','staff_time_off','salon_closures']) denied(await clients.anon.from(table).select('*'));
  for (const role of ['anon','owner','manager','stylist','unprofiled']) denied(await clients[role].rpc('request_booking', bookingArgs()));
});

test('disponibilidad real calcula duración, intervalos de15 minutos, descanso, excepciones y vacaciones', async () => {
  const short = ok(await slots(dates[0])), long = ok(await slots(dates[0], service120));
  assert.equal(short.length, 20); assert.equal(long.length, 12);
  assert.ok(short.some(row => row.start_time === '13:15' && row.end_time === '14:15'));
  assert.ok(!short.some(row => row.start_time === '14:15'), 'A service may not cross a break');
  assert.ok(long.some(row => row.start_time === '13:00' && row.end_time === '15:00'));
  assert.ok(!long.some(row => row.start_time === '13:15'));
  assert.deepEqual(ok(await slots(dates[1])), []);
  assert.deepEqual(ok(await slots(dates[2])), []);
  assert.ok(ok(await slots(dates[2], service60, staffB)).length > 0);
  assert.deepEqual(ok(await slots(dates[3], service60, staffB)), []);
  assert.deepEqual(ok(await slots(dates[4], service120)), [{ start_time: '10:00', end_time: '12:00' }]);
  assert.deepEqual(ok(await slots(dates[0], service60, staffPrivate)), []);
  assert.deepEqual(ok(await slots(dates[0], service60, staffInactive)), []);
  assert.deepEqual(ok(await slots(dates[0], serviceInactive)), []);
  assert.deepEqual(ok(await slots(addDays(91))), []);
  // json_agg(record) includes newlines between records in psql's text output.
  // jsonb_agg serializes one complete JSON value on the last line, after SET.
  const inTokyo = JSON.parse(stack.sql(`set timezone='Asia/Tokyo'; select coalesce(jsonb_agg(t),'[]'::jsonb) from public.available_slots('${staffA}','${service60}','${dates[0]}') t;`).split('\n').at(-1));
  assert.deepEqual(inTokyo, short, 'Business availability must use America/Asuncion, independent of session timezone');
});

test('solicitud pendiente persistida reserva su intervalo; reintento idempotente no duplica registros', async () => {
  const args = bookingArgs({ name: 'Cliente Solicitud Persistida' });
  const first = ok(await clients.gateway.rpc('request_booking', args));
  assert.deepEqual(first, { reference: args.p_request_id, status: 'pendiente' });
  assert.deepEqual(ok(await clients.gateway.rpc('request_booking', args)), first);
  assert.equal(ok(await clients.manager.from('appointments').select('id').eq('client_name', args.p_name)).length, 1);
  assert.ok(!ok(await slots(args.p_date)).some(slot => slot.start_time === '13:00'));
  const mismatch = await clients.gateway.rpc('request_booking', { ...args, p_name: 'Otro Nombre' });
  assert.equal(mismatch.error?.code, '22023');
  const row = await appointment(args.p_name);
  assert.equal(row.status, 'pendiente'); assert.equal(row.end_time, '14:00:00');
  const events = ok(await clients.owner.from('appointment_events').select('*').eq('appointment_id', row.id));
  assert.equal(events.length, 1); assert.equal(events[0].source, 'public_request');
  assert.equal(events[0].actor_id, null);
});

test('la base vuelve a validar anticipación, fecha, grilla y publicación sin confiar en el formulario', async () => {
  for (const changes of [
    { date: addDays(-1) }, { date: businessToday, time: '00:00' },
    { date: addDays(91) }, { staff: staffPrivate }, { staff: staffInactive }, { service: serviceInactive }
  ]) {
    assert.equal((await clients.gateway.rpc('request_booking', bookingArgs(changes))).error?.code, '23514');
  }
  assert.equal((await clients.gateway.rpc('request_booking', bookingArgs({ time: '13:10' }))).error?.code, '22023');
  assert.deepEqual(ok(await slots(addDays(-1))), []);
});

test('solicitudes simultáneas con diferentes duraciones no se superponen; otro profesional puede atender', async () => {
  const result = await Promise.all([
    clients.gateway.rpc('request_booking', bookingArgs({ date: dates[6], service: service120, time: '16:00', name: 'Cliente Largo Concurrente' })),
    clients.gateway.rpc('request_booking', bookingArgs({ date: dates[6], time: '17:00', name: 'Cliente Corto Concurrente' }))
  ]);
  assert.equal(result.filter(row => !row.error).length, 1);
  assert.equal(result.filter(row => row.error?.code === '23P01').length, 1);
  ok(await clients.gateway.rpc('request_booking', bookingArgs({ date: dates[6], staff: staffB, time: '17:00', name: 'Cliente Otro Profesional' })));
  const rows = ok(await clients.owner.from('appointments').select('id').eq('appointment_date', dates[6]));
  assert.equal(rows.length, 2);
});

test('altas administrativas pendientes simultáneas comparten el bloqueo del profesional', async () => {
  // Pending rows are deliberately outside the legacy exclusion constraint.
  // This exercises the new trigger/staff lock, independently of the public rate lock.
  const attempts = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    clients.manager.from('appointments').insert(teamAppointment(dates[22], {
      client_name: 'Cliente Administrativo Concurrente ' + index, status: 'pendiente',
      service_id: index % 2 ? service120 : service60
    })).select('id')));
  assert.equal(attempts.filter(result => !result.error).length, 1);
  assert.equal(attempts.filter(result => result.error?.code === '23P01').length, 3);
  assert.equal(ok(await clients.manager.from('appointments').select('id').eq('appointment_date', dates[22])).length, 1);
});

test('reservas públicas simultáneas del mismo inicio y reintentos del mismo UUID son atómicos', async () => {
  const contenders = await Promise.all(Array.from({ length: 3 }, () =>
    clients.gateway.rpc('request_booking', bookingArgs({ date: dates[23] }))));
  assert.equal(contenders.filter(result => !result.error).length, 1);
  assert.equal(contenders.filter(result => result.error?.code === '23P01').length, 2);
  const args = bookingArgs({ date: dates[24], name: 'Cliente Reintento Concurrente' });
  const replay = await Promise.all([
    clients.gateway.rpc('request_booking', args), clients.gateway.rpc('request_booking', args)
  ]);
  assert.deepEqual(ok(replay[0]), ok(replay[1]));
  const row = await appointment(args.p_name);
  assert.equal(ok(await clients.manager.from('appointment_events').select('id').eq('appointment_id', row.id)).length, 1);
});

test('cierre de salón concurrente con solicitud nunca deja una cita activa dentro de un cierre', async () => {
  const [booking, closure] = await Promise.all([
    clients.gateway.rpc('request_booking', bookingArgs({ date: dates[25] })),
    clients.manager.from('salon_closures').insert({ start_date: dates[25], end_date: dates[25], reason: 'Cierre concurrente' })
  ]);
  assert.equal([booking, closure].filter(result => !result.error).length, 1);
  assert.equal([booking, closure].filter(result => result.error?.code === '23514').length, 1);
  const appointments = ok(await clients.manager.from('appointments').select('id').eq('appointment_date', dates[25]));
  const closures = ok(await clients.manager.from('salon_closures').select('id').eq('start_date', dates[25]));
  assert.equal(appointments.length + closures.length, 1);
});

test('Edge local verifica CAPTCHA y persiste mediante la RPC privada sin duplicar el reintento', async () => {
  const body = { request_id: randomUUID(), name: 'Cliente Edge Persistente', phone: '0985 123456',
    service_id: service60, staff_id: staffA, date: dates[26], time: '13:00',
    captcha_token: 'local-widget-token-initial', website: '' };
  const submit = value => fetch(edgeOrigin + '/functions/v1/booking', { method: 'POST',
    headers: { Origin: site.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const first = await submit(body);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { reference: body.request_id, status: 'pendiente' });
  const retry = await submit({ ...body, captcha_token: 'local-widget-token-retry' });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { reference: body.request_id, status: 'pendiente' });
  assert.equal((await appointment(body.name)).status, 'pendiente');
  const invalid = await submit({ ...body, request_id: randomUUID(), captcha_token: 'invalid-captcha' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'CAPTCHA_FAILED');
  const conflict = await submit({ ...body, request_id: randomUUID(), phone: '0985 123457' });
  assert.equal(conflict.status, 409);
  const error = await conflict.json();
  assert.equal(error.error, 'CONFLICT');
  assert.ok(!JSON.stringify(error).includes(body.name));
  assert.equal(verifyCount, 4);
  assert.equal(ok(await clients.manager.from('appointments').select('id').eq('client_name', body.name)).length, 1);
});

test('manager confirma, reprograma con duración autoritativa y cancela liberando el horario', async () => {
  const args = bookingArgs({ date: dates[7], name: 'Cliente Ciclo Reprogramación' });
  ok(await clients.gateway.rpc('request_booking', args));
  const original = await appointment(args.p_name);
  ok(await clients.manager.from('appointments').update({ status: 'confirmado' }).eq('id', original.id));
  const changed = ok(await clients.manager.from('appointments').update({ start_time: '16:00', end_time: '16:15', service_id: service120 }).eq('id', original.id).select().single());
  assert.equal(changed.end_time, '18:00:00');
  assert.ok(ok(await slots(args.p_date)).some(slot => slot.start_time === '13:00'));
  assert.ok(!ok(await slots(args.p_date)).some(slot => slot.start_time === '16:00'));
  ok(await clients.manager.from('appointments').update({ status: 'cancelado' }).eq('id', original.id));
  assert.ok(ok(await slots(args.p_date)).some(slot => slot.start_time === '16:00'));
  assert.equal((await clients.manager.from('appointments').update({ status: 'confirmado' }).eq('id', original.id)).error?.code, '23514');
  denied(await clients.manager.from('appointments').delete().eq('id', original.id));
  assert.equal(ok(await clients.owner.from('appointment_events').select('id').eq('appointment_id', original.id)).length, 4);
});

test('completada y no asistida conservan historial; motor rechaza fuera de jornada y cambios que invalidan citas', async () => {
  const complete = ok(await clients.manager.from('appointments').insert(teamAppointment(dates[8])).select().single());
  assert.equal(complete.end_time, '14:00:00');
  ok(await clients.manager.from('appointments').update({ status: 'en-proceso' }).eq('id', complete.id));
  ok(await clients.manager.from('appointments').update({ status: 'completado' }).eq('id', complete.id));
  const absent = ok(await clients.manager.from('appointments').insert(teamAppointment(dates[9], { client_name: 'Cliente No Asistido' })).select().single());
  ok(await clients.manager.from('appointments').update({ status: 'no-asistio' }).eq('id', absent.id));
  assert.ok(ok(await slots(dates[9])).some(slot => slot.start_time === '13:00'));
  assert.equal((await clients.manager.from('appointments').insert(teamAppointment(dates[10], { start_time: '14:30' }))).error?.code, '23514');
  const active = ok(await clients.manager.from('appointments').insert(teamAppointment(dates[10], { client_name: 'Cliente Protegido' })).select().single());
  assert.equal((await clients.manager.from('staff_time_off').insert({ staff_id: staffA, start_date: dates[10], end_date: dates[10] })).error?.code, '23514');
  assert.equal((await clients.manager.from('salon_closures').insert({ start_date: dates[10], end_date: dates[10] })).error?.code, '23514');
  assert.equal((await clients.manager.rpc('replace_schedule_day', { p_staff_id: staffA, p_date: dates[10], p_intervals: [] })).error?.code, '23514');
  assert.equal((await clients.owner.from('appointments').select('id').eq('id', active.id).single()).error, null);
});

test('stylist solo lee citas y configuración propias, sin editar horarios, estados ni auditoría', async () => {
  const own = ok(await clients.stylist.from('appointments').select('*'));
  assert.ok(own.length > 0); assert.ok(own.every(row => row.staff_id === staffA));
  const before = own[0];
  const modified = await clients.stylist.from('appointments').update({ client_name: 'Cambio no autorizado' }).eq('id', before.id).select();
  assert.ok(modified.error || modified.data.length === 0);
  assert.equal((await appointment(before.client_name)).client_name, before.client_name);
  const hours = ok(await clients.stylist.from('staff_working_hours').select('*'));
  assert.ok(hours.length > 0); assert.ok(hours.every(row => row.staff_id === staffA));
  assert.deepEqual(ok(await clients.stylist.from('appointment_events').select('*')), []);
  denied(await clients.stylist.rpc('replace_working_hours', { p_staff_id: staffA, p_intervals: [] }));
  denied(await clients.stylist.rpc('admin_available_slots', { p_staff_id: staffA, p_service_id: service60, p_date: dates[0] }));
  assert.deepEqual(ok(await clients.unprofiled.from('appointments').select('*')), []);
});

test('límites atómicos por teléfono e IP rechazan exceso sin crear citas', async () => {
  const phone = '+595999999111';
  for (let i=0;i<3;i++) ok(await clients.gateway.rpc('request_booking', bookingArgs({ date: dates[12+i], phone, name: 'Cliente Límite Teléfono' })));
  const overPhone = await clients.gateway.rpc('request_booking', bookingArgs({ date: dates[15], phone, name: 'Cliente Límite Teléfono' }));
  assert.equal(overPhone.error?.code, 'P0001'); assert.equal(overPhone.error?.message, 'RATE_LIMITED');
  const ipHash = hash('shared-local-ip-rate');
  for (let i=0;i<5;i++) ok(await clients.gateway.rpc('request_booking', bookingArgs({ date: dates[16+i], ipHash, name: 'Cliente Límite IP' })));
  const overIp = await clients.gateway.rpc('request_booking', bookingArgs({ date: dates[21], ipHash, name: 'Cliente Límite IP' }));
  assert.equal(overIp.error?.code, 'P0001');
  assert.equal(ok(await clients.owner.from('appointments').select('id').eq('client_name', 'Cliente Límite Teléfono')).length, 3);
  assert.equal(ok(await clients.owner.from('appointments').select('id').eq('client_name', 'Cliente Límite IP')).length, 5);
});

test('regresión Fase 1 con agenda instalada: venta concurrente, stock, costo histórico, gastos e informes por rol', async () => {
  const productId = randomUUID();
  ok(await clients.owner.from('products').insert({ id: productId, name: 'Producto regresión agenda',
    sku: 'AGENDA-' + productId, category: 'Venta', cost_gs: 65000, sale_price_gs: 110000 }));
  ok(await clients.owner.rpc('record_stock_movement', { p_product_id: productId, p_delta_qty: 1,
    p_kind: 'entrada', p_note: 'Stock local de regresión' }));
  const sale = { p_kind: 'producto', p_product_id: productId, p_service_id: null,
    p_sale_date: businessToday, p_quantity: 1, p_unit_price_gs: 110000, p_unit_cost_gs: 1,
    p_payment_method: 'Efectivo', p_customer_name: 'Cliente regresión agenda', p_notes: '' };
  const results = await Promise.all([
    clients.owner.rpc('register_sale', sale), clients.manager.rpc('register_sale', sale)
  ]);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal(results.filter(result => result.error?.code === '23514').length, 1);
  assert.equal(ok(await clients.manager.from('products').select('stock_qty').eq('id', productId).single()).stock_qty, 0);
  const sales = ok(await clients.owner.from('sales').select('*').eq('product_id', productId));
  assert.equal(sales.length, 1);
  assert.equal(sales[0].unit_cost_gs, 65000, 'El costo histórico se toma del producto, no del navegador');
  const movements = ok(await clients.owner.from('stock_movements').select('*').eq('product_id', productId));
  assert.equal(movements.length, 2);
  assert.equal(movements.reduce((sum, movement) => sum + movement.delta_qty, 0), 0);
  ok(await clients.manager.from('expenses').insert({ expense_date: businessToday, category: 'Operativo',
    description: 'Gasto local de regresión', amount_gs: 10000 }));
  const month = businessToday.slice(0, 7) + '-01';
  for (const role of ['owner', 'manager']) {
    const report = ok(await clients[role].rpc('report_financials', { p_month: month }));
    assert.equal(report.salesCount, 1);
    assert.equal(report.revenue, 110000);
    assert.equal(report.directCosts, 65000);
    assert.equal(report.overhead, 10000);
    assert.equal(report.balance, 35000);
    denied(await clients[role].from('products').update({ stock_qty: 99 }).eq('id', productId));
    denied(await clients[role].from('sales').delete().eq('product_id', productId));
    denied(await clients[role].from('stock_movements').delete().eq('product_id', productId));
  }
  for (const role of ['anon', 'stylist', 'unprofiled']) {
    for (const table of ['products', 'sales', 'stock_movements', 'expenses', 'clients']) {
      const result = await clients[role].from(table).select('*');
      if (role === 'anon') denied(result); else assert.deepEqual(ok(result), []);
    }
    denied(await clients[role].rpc('register_sale', sale));
    denied(await clients[role].rpc('record_stock_movement', { p_product_id: productId, p_delta_qty: 1, p_kind: 'entrada' }));
    assert.equal((await clients[role].rpc('report_financials', { p_month: month })).error?.code, '42501');
  }
});

test('matriz RLS de configuración nueva: owner y manager escriben, stylist solo lee lo propio y auditoría no admite escritura', async () => {
  ok(await clients.owner.rpc('replace_schedule_day', { p_staff_id: staffB, p_date: dates[29],
    p_intervals: [{ start_time: '13:00', end_time: '15:00' }] }));
  ok(await clients.owner.from('staff_time_off').insert({ staff_id: staffB, start_date: dates[30], end_date: dates[30] }));
  ok(await clients.owner.from('salon_closures').insert({ start_date: dates[31], end_date: dates[31] }));
  ok(await clients.owner.from('staff_booking_settings').update({ public_enabled: true }).eq('staff_id', staffPrivate));
  ok(await clients.owner.rpc('replace_working_hours', { p_staff_id: staffPrivate,
    p_intervals: [{ weekday: 1, start_time: '10:00', end_time: '12:00' }] }));
  const privateTables = ['staff_booking_settings', 'staff_working_hours', 'staff_schedule_exceptions', 'staff_time_off'];
  for (const table of [...privateTables, 'salon_closures']) {
    for (const role of ['owner', 'manager']) assert.ok(ok(await clients[role].from(table).select('*')).length > 0);
    denied(await clients.anon.from(table).select('*'));
    assert.deepEqual(ok(await clients.unprofiled.from(table).select('*')), []);
    const own = ok(await clients.stylist.from(table).select('*'));
    assert.ok(own.length > 0);
    if (table !== 'salon_closures') assert.ok(own.every(row => row.staff_id === staffA));
  }
  for (const [table, body] of [
    ['staff_booking_settings', { staff_id: staffPrivate, public_enabled: true }],
    ['staff_working_hours', { staff_id: staffA, weekday: 1, start_time: '10:00', end_time: '12:00' }],
    ['staff_schedule_exceptions', { staff_id: staffA, date: dates[32] }],
    ['staff_time_off', { staff_id: staffA, start_date: dates[32], end_date: dates[32] }],
    ['salon_closures', { start_date: dates[32], end_date: dates[32] }]
  ]) {
    for (const role of ['stylist', 'unprofiled']) denied(await clients[role].from(table).insert(body));
    const before = ok(await clients.stylist.from(table).select('*'));
    const updated = await clients.stylist.from(table).update(body).eq('id' in before[0] ? 'id' : 'staff_id', before[0].id || before[0].staff_id).select();
    assert.ok(updated.error || updated.data.length === 0);
    const removed = await clients.stylist.from(table).delete().eq('id' in before[0] ? 'id' : 'staff_id', before[0].id || before[0].staff_id).select();
    assert.ok(removed.error || removed.data.length === 0);
    assert.deepEqual(ok(await clients.stylist.from(table).select('*')), before);
  }
  for (const role of ['owner', 'manager', 'stylist', 'unprofiled']) {
    denied(await clients[role].from('appointment_events').update({ source: 'team' }).neq('id', '00000000-0000-0000-0000-000000000000'));
    denied(await clients[role].from('appointment_events').delete().neq('id', '00000000-0000-0000-0000-000000000000'));
  }
});
