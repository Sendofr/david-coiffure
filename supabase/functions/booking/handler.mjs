// Shared Fetch API handler: run by the Edge Function and exercised directly in tests.
// No test bypass exists in configuration. Tests inject the provider transport only.
const BODY_LIMIT = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = new Set(['request_id', 'name', 'phone', 'service_id', 'staff_id', 'date', 'time', 'captcha_token', 'website']);
const MESSAGES = {
  CONFIGURATION_REQUIRED: 'Las reservas en línea todavía no están habilitadas.',
  FORBIDDEN_ORIGIN: 'Origen de solicitud no permitido.',
  INVALID_REQUEST: 'Revisá los datos de la solicitud.',
  PAYLOAD_TOO_LARGE: 'La solicitud supera el tamaño permitido.',
  CAPTCHA_FAILED: 'Completá nuevamente la verificación de seguridad.',
  CONFLICT: 'Ese horario ya no está disponible. Elegí otro.',
  RATE_LIMITED: 'Se alcanzó el límite de solicitudes. Intentá más tarde.',
  DEPENDENCY_UNAVAILABLE: 'No se pudo verificar la solicitud. Reintentá con la misma referencia.'
};
class BookingError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function validOrigin(value) {
  try {
    const url = new URL(value);
    return value === url.origin && !url.username && !url.password && !url.hostname.includes('*') &&
      (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
function configuration(env) {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'BOOKING_RATE_SECRET', 'BOOKING_ALLOWED_ORIGINS'];
  const config = Object.fromEntries(names.map(name => [name, String(env[name] || '').trim()]));
  if (names.some(name => !config[name]) || config.BOOKING_RATE_SECRET.length < 32) throw new BookingError(503, 'CONFIGURATION_REQUIRED');
  let project;
  try { project = new URL(config.SUPABASE_URL); } catch { throw new BookingError(503, 'CONFIGURATION_REQUIRED'); }
  const cloud = project.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/i.test(project.hostname) && !project.port;
  const local = project.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]', 'kong'].includes(project.hostname);
  if ((!cloud && !local) || project.username || project.password || project.pathname !== '/' || project.search || project.hash) throw new BookingError(503, 'CONFIGURATION_REQUIRED');
  const origins = config.BOOKING_ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  if (!origins.length || origins.length > 50 || !origins.every(validOrigin)) throw new BookingError(503, 'CONFIGURATION_REQUIRED');
  return { ...config, SUPABASE_URL: project.origin, origins: new Set(origins) };
}
async function boundedJson(request) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) throw new BookingError(413, 'PAYLOAD_TOO_LARGE');
  if (!request.body) throw new BookingError(400, 'INVALID_REQUEST');
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); throw new BookingError(413, 'PAYLOAD_TOO_LARGE'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const joined = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return body;
  } catch { throw new BookingError(400, 'INVALID_REQUEST'); }
}
export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+0-9 ()-]{6,30}$/.test(value)) throw new BookingError(400, 'INVALID_REQUEST');
  let phone = value.replace(/[ ()-]/g, '');
  if (/^09\d{8}$/.test(phone)) phone = '+595' + phone.slice(1);
  else if (/^595\d{9}$/.test(phone)) phone = '+' + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new BookingError(400, 'INVALID_REQUEST');
  return phone;
}
export function validatedPayload(body) {
  if (Object.keys(body).some(key => !FIELDS.has(key)) || body.website !== undefined && body.website !== '') throw new BookingError(400, 'INVALID_REQUEST');
  for (const key of ['request_id', 'service_id', 'staff_id']) if (typeof body[key] !== 'string' || !UUID.test(body[key])) throw new BookingError(400, 'INVALID_REQUEST');
  if (typeof body.name !== 'string' || /[\p{Cc}\p{Cf}]/u.test(body.name)) throw new BookingError(400, 'INVALID_REQUEST');
  const name = body.name.normalize('NFC').trim().replace(/ +/g, ' ');
  if (name.length < 2 || name.length > 100 || !/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(name)) throw new BookingError(400, 'INVALID_REQUEST');
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new BookingError(400, 'INVALID_REQUEST');
  const date = new Date(body.date + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.date) throw new BookingError(400, 'INVALID_REQUEST');
  if (typeof body.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.time)) throw new BookingError(400, 'INVALID_REQUEST');
  if (typeof body.captcha_token !== 'string' || body.captcha_token.length < 1 || body.captcha_token.length > 2048 || /\s/.test(body.captcha_token)) throw new BookingError(400, 'INVALID_REQUEST');
  return { request_id: body.request_id.toLowerCase(), name, phone: normalizePhone(body.phone), service_id: body.service_id.toLowerCase(), staff_id: body.staff_id.toLowerCase(), date: body.date, time: body.time, captcha_token: body.captcha_token };
}
// Supabase's gateway supplies forwarded addresses. Do not treat arbitrary request
// headers as an authenticated identity: this is only an additional rate-limit hint.
// CAPTCHA verification, canonical phone limits and the global DB limit do not depend
// on this header being trustworthy. We never store or log the raw address.
function addressHint(request) {
  const chain = request.headers.get('x-forwarded-for') || '';
  const address = chain.split(',').at(-1).trim();
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) && address.split('.').every(part => Number(part) <= 255);
  let ipv6 = false;
  if (address.includes(':') && /^[0-9a-f:]+$/i.test(address)) {
    try { ipv6 = new URL('http://[' + address + ']').hostname.startsWith('['); } catch {}
  }
  if (!ipv4 && !ipv6) throw new BookingError(400, 'INVALID_REQUEST');
  return address.toLowerCase();
}
async function fingerprint(crypto, key, domain, value) {
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(domain + ':' + value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createBookingHandler({ env, fetch: transport = globalThis.fetch, crypto = globalThis.crypto }) {
  let config, keyPromise;
  try {
    config = configuration(env || {});
    keyPromise = crypto.subtle.importKey('raw', new TextEncoder().encode(config.BOOKING_RATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  } catch { config = null; }
  return async function handle(request) {
    const origin = request.headers.get('origin') || '';
    const allowed = Boolean(config?.origins.has(origin));
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (allowed) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...headers, ...extra } });
    try {
      if (!config) throw new BookingError(503, 'CONFIGURATION_REQUIRED');
      if (!allowed) throw new BookingError(403, 'FORBIDDEN_ORIGIN');
      if (request.method === 'OPTIONS') return reply(204, null, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info, x-supabase-api-version', 'Access-Control-Max-Age': '600' });
      if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED', message: 'Usá POST para enviar la solicitud.' }, { Allow: 'POST, OPTIONS' });
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new BookingError(400, 'INVALID_REQUEST');
      const payload = validatedPayload(await boundedJson(request));
      const ip = addressHint(request);
      let verification;
      try {
        const response = await transport('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret: config.TURNSTILE_SECRET_KEY, response: payload.captcha_token, idempotency_key: payload.request_id }),
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) throw Error();
        verification = await response.json();
      } catch { throw new BookingError(503, 'DEPENDENCY_UNAVAILABLE'); }
      if (verification?.success !== true || verification.hostname !== new URL(origin).hostname || verification.action !== 'booking') throw new BookingError(400, 'CAPTCHA_FAILED');
      const hmacKey = await keyPromise;
      const [ipHash, phoneHash] = await Promise.all([fingerprint(crypto, hmacKey, 'ip', ip), fingerprint(crypto, hmacKey, 'phone', payload.phone)]);
      let response, result;
      try {
        response = await transport(config.SUPABASE_URL + '/rest/v1/rpc/request_booking', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + config.SUPABASE_SERVICE_ROLE_KEY },
          body: JSON.stringify({ p_request_id: payload.request_id, p_name: payload.name, p_phone: payload.phone, p_service_id: payload.service_id, p_staff_id: payload.staff_id, p_date: payload.date, p_time: payload.time, p_ip_hash: ipHash, p_phone_hash: phoneHash }),
          signal: AbortSignal.timeout(15_000)
        });
        result = await response.json();
      } catch { throw new BookingError(503, 'DEPENDENCY_UNAVAILABLE'); }
      if (!response.ok) {
        if (result?.code === 'P0001' && result?.message === 'RATE_LIMITED') throw new BookingError(429, 'RATE_LIMITED');
        if (['23P01', '23514'].includes(result?.code)) throw new BookingError(409, 'CONFLICT');
        if (result?.code === '22023') throw new BookingError(400, 'INVALID_REQUEST');
        throw new BookingError(503, 'DEPENDENCY_UNAVAILABLE');
      }
      if (!result || result.reference !== payload.request_id || result.status !== 'pendiente') throw new BookingError(503, 'DEPENDENCY_UNAVAILABLE');
      return reply(200, { reference: result.reference, status: 'pendiente' });
    } catch (error) {
      const known = error instanceof BookingError;
      const code = known ? error.code : 'DEPENDENCY_UNAVAILABLE';
      return reply(known ? error.status : 503, { error: code, message: MESSAGES[code] }, code === 'RATE_LIMITED' ? { 'Retry-After': '600' } : {});
    }
  };
}
