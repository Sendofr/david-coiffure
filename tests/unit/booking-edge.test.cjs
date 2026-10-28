const { before, test } = require('node:test');
const assert = require('node:assert/strict');
let createBookingHandler, normalizePhone, validatedPayload;
before(async () => ({ createBookingHandler, normalizePhone, validatedPayload } = await import('../../supabase/functions/booking/handler.mjs')));

const origin = 'https://agenda-preview.example.test';
const env = {
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'TEST-ONLY-private-service-role-not-a-real-credential',
  TURNSTILE_SECRET_KEY: 'TEST-ONLY-private-turnstile-not-a-real-credential',
  BOOKING_RATE_SECRET: 'TEST-ONLY-private-rate-salt-01234567890123456789',
  BOOKING_ALLOWED_ORIGINS: origin,
};
const payload = (changes = {}) => ({ request_id: '00000000-0000-4000-8000-000000000001', name: '  María   Pérez ', phone: '0985 499769', service_id: '10000000-0000-4000-8000-000000000001', staff_id: '20000000-0000-4000-8000-000000000001', date: '2030-11-02', time: '14:00', captcha_token: 'test-captcha-token', website: '', ...changes });
function request(body = payload(), options = {}) {
  return new Request('https://test-project.supabase.co/functions/v1/booking', {
    method: options.method || 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.100', ...options.headers },
    body: options.method === 'OPTIONS' || options.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function fixture({ verification, rpcStatus = 200, rpcBody, config = {}, providerFailure = false, rpcFailure = false } = {}) {
  const calls = [];
  const handler = createBookingHandler({ env: { ...env, ...config }, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      if (providerFailure) throw Error('PRIVATE PROVIDER DIAGNOSTIC');
      return Response.json(verification || { success: true, hostname: new URL(origin).hostname, action: 'booking' });
    }
    if (rpcFailure) throw Error('PRIVATE DB DIAGNOSTIC');
    const sent = JSON.parse(options.body);
    return Response.json(rpcBody || { reference: sent.p_request_id, status: 'pendiente' }, { status: rpcStatus });
  } });
  return { handler, calls };
}
test('successful public booking verifies CAPTCHA, canonicalizes only necessary data and returns a private receipt', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reference: payload().request_id, status: 'pendiente' });
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const verification = new URLSearchParams(calls[0].options.body);
  assert.equal(verification.get('response'), payload().captcha_token);
  assert.equal(verification.get('idempotency_key'), payload().request_id);
  assert.equal(verification.get('secret'), env.TURNSTILE_SECRET_KEY);
  assert.equal(calls[1].url, env.SUPABASE_URL + '/rest/v1/rpc/request_booking');
  const rpc = JSON.parse(calls[1].options.body);
  assert.equal(rpc.p_name, 'María Pérez');
  assert.equal(rpc.p_phone, '+595985499769');
  assert.match(rpc.p_ip_hash, /^[0-9a-f]{64}$/);
  assert.match(rpc.p_phone_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rpc.p_ip_hash, rpc.p_phone_hash);
  assert.deepEqual(Object.keys(rpc).sort(), ['p_request_id','p_name','p_phone','p_service_id','p_staff_id','p_date','p_time','p_ip_hash','p_phone_hash'].sort());
  assert.ok(!calls[1].options.body.includes('192.0.2.100'));
  assert.equal(calls[1].options.headers.Authorization, 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY);
});
test('different salts separate private rate identities while the same salt is deterministic', async () => {
  const first = fixture(), repeat = fixture(), rotated = fixture({ config: { BOOKING_RATE_SECRET: 'ANOTHER-test-only-private-rate-salt-01234567890' } });
  for (const f of [first, repeat, rotated]) assert.equal((await f.handler(request())).status, 200);
  const hashes = [first, repeat, rotated].map(f => JSON.parse(f.calls[1].options.body));
  assert.equal(hashes[0].p_ip_hash, hashes[1].p_ip_hash);
  assert.equal(hashes[0].p_phone_hash, hashes[1].p_phone_hash);
  assert.notEqual(hashes[0].p_phone_hash, hashes[2].p_phone_hash);
});
test('origin allowlist is exact and neither wildcard nor missing/forged sibling origins get CORS permission', async () => {
  for (const value of ['', 'https://agenda-preview.example.test.attacker.test', 'https://another.vercel.app', 'null']) {
    const f = fixture();
    const response = await f.handler(request(payload(), { headers: { origin: value } }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(f.calls.length, 0);
  }
  for (const bad of ['*', 'https://*.vercel.app', origin + '/path', origin + '/', 'https://user:password@example.test']) {
    const f = fixture({ config: { BOOKING_ALLOWED_ORIGINS: bad } });
    assert.equal((await f.handler(request())).status, 503);
    assert.equal(f.calls.length, 0);
  }
});
test('preflight allows only the configured origin and POST transport without credentials', async () => {
  const f = fixture();
  const response = await f.handler(request(undefined, { method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(f.calls.length, 0);
});
test('missing secrets, malformed project URL and weak rate secret fail closed before provider or database calls', async () => {
  for (const name of Object.keys(env)) {
    const f = fixture({ config: { [name]: '' } });
    assert.equal((await f.handler(request())).status, 503, name);
    assert.equal(f.calls.length, 0);
  }
  for (const url of ['http://test-project.supabase.co', 'https://test-project.supabase.co.evil.test', 'https://user:pass@test-project.supabase.co', 'https://test-project.supabase.co/path']) {
    assert.equal((await fixture({ config: { SUPABASE_URL: url } }).handler(request())).status, 503);
  }
  assert.equal((await fixture({ config: { BOOKING_RATE_SECRET: 'weak' } }).handler(request())).status, 503);
});
test('wrong method/content type, invalid JSON, oversized bodies and honeypots never reach external services', async () => {
  const cases = [
    request(undefined, { method: 'GET' }), request(payload(), { headers: { 'content-type': 'text/plain' } }), request('{ broken'),
    request('x'.repeat(8193)), request(payload({ website: 'spam' })), request(payload({ extra: 'not collected' })),
  ];
  for (const req of cases) {
    const f = fixture(); const response = await f.handler(req);
    assert.ok([400, 405, 413].includes(response.status));
    assert.equal(f.calls.length, 0);
  }
});
test('streaming body limits work without a Content-Length header', async () => {
  const f = fixture();
  const req = new Request('https://test-project.supabase.co/functions/v1/booking', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.100' }, duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4096)); controller.enqueue(new Uint8Array(4097)); controller.close(); } }),
  });
  assert.equal((await f.handler(req)).status, 413);
  assert.equal(f.calls.length, 0);
});
test('field validation rejects malformed IDs, dates, times, names, phones and CAPTCHA inputs', async () => {
  for (const changes of [
    { request_id: 'abc' }, { service_id: 1 }, { staff_id: null }, { date: '2030-02-30' }, { date: 'tomorrow' }, { time: '24:00' },
    { time: '14:00:00' }, { name: '<script>attack</script>' }, { name: 'A' }, { name: 'A\nB' }, { name: 'X'.repeat(101) },
    { phone: '000' }, { phone: '+000000000' }, { phone: '+595abc' }, { captcha_token: '' }, { captcha_token: 'x'.repeat(2049) },
  ]) {
    const f = fixture(); assert.equal((await f.handler(request(payload(changes)))).status, 400, JSON.stringify(changes));
    assert.equal(f.calls.length, 0);
  }
});
test('phone normalization supports local Paraguay mobiles and canonical international numbers', () => {
  assert.equal(normalizePhone('0985 499769'), '+595985499769');
  assert.equal(normalizePhone('595985499769'), '+595985499769');
  assert.equal(normalizePhone('+595 (985) 499-769'), '+595985499769');
  assert.equal(validatedPayload(payload({ name: 'Mari\u0301a Pérez' })).name, 'María Pérez');
});
test('failed, replayed, wrong-hostname and wrong-action CAPTCHA results never reach PostgreSQL', async () => {
  for (const verification of [
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, hostname: 'attacker.test', action: 'booking' },
    { success: true, hostname: new URL(origin).hostname, action: 'login' },
    { success: true },
  ]) {
    const f = fixture({ verification });
    const response = await f.handler(request());
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'CAPTCHA_FAILED');
    assert.equal(f.calls.length, 1);
  }
});
test('provider and database outages return generic 503 without leaking secrets or diagnostics', async () => {
  for (const failure of [{ providerFailure: true }, { rpcFailure: true }, { rpcStatus: 500, rpcBody: { code: 'XX000', message: 'PRIVATE DB DETAIL' } }]) {
    const f = fixture(failure); const response = await f.handler(request());
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.doesNotMatch(body, /PRIVATE|TEST-ONLY|service-role|rate-salt/);
  }
});
test('database conflict, validation and rate outcomes become safe public errors', async () => {
  for (const [code, message, status, expected] of [
    ['23P01','PRIVATE CLIENT',409,'CONFLICT'], ['23514','PRIVATE SCHEDULE',409,'CONFLICT'],
    ['22023','PAYLOAD MISMATCH',400,'INVALID_REQUEST'], ['P0001','RATE_LIMITED',429,'RATE_LIMITED'],
  ]) {
    const f = fixture({ rpcStatus: 400, rpcBody: { code, message } });
    const response = await f.handler(request());
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, expected);
    if (status === 429) assert.equal(response.headers.get('retry-after'), '600');
  }
});
test('idempotent same-reference retries retain DB identity and malformed receipts fail closed', async () => {
  const f = fixture();
  const first = await f.handler(request()), retry = await f.handler(request(payload({ captcha_token: 'fresh-captcha-token' })));
  assert.deepEqual(await first.json(), await retry.json());
  const sent = f.calls.filter(call => call.url.includes('/rest/v1/')).map(call => JSON.parse(call.options.body));
  assert.equal(sent[0].p_request_id, sent[1].p_request_id);
  for (const bad of [{ reference: 'different', status: 'pendiente' }, { reference: payload().request_id, status: 'confirmado' }, null]) {
    const broken = fixture({ rpcBody: bad || [] });
    assert.equal((await broken.handler(request())).status, 503);
  }
});
test('only a salted gateway address hint is sent, and missing/invalid addresses fail closed', async () => {
  for (const value of ['', 'not-an-ip', '999.1.1.1']) {
    const f = fixture(); assert.equal((await f.handler(request(payload(), { headers: { 'x-forwarded-for': value } }))).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const first = fixture(), second = fixture();
  await first.handler(request(payload(), { headers: { 'x-forwarded-for': '203.0.113.1, 192.0.2.100' } }));
  await second.handler(request());
  assert.equal(JSON.parse(first.calls[1].options.body).p_ip_hash, JSON.parse(second.calls[1].options.body).p_ip_hash);
  const ipv6 = fixture();
  assert.equal((await ipv6.handler(request(payload(), { headers: { 'x-forwarded-for': '2001:db8::1' } }))).status, 200);
});
