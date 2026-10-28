// Disposable local stack: real GoTrue + PostgREST + PostgreSQL, never a linked project.
import { execFileSync } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import { createServer, request } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const images = {
  postgres: 'postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b',
  auth: 'supabase/gotrue:v2.186.0@sha256:f2112b9289422f205df4ea15b8b550d425ae42528ea54521faa32cc7b62490de',
  rest: 'postgrest/postgrest:v13.0.7@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228'
};
const wait = ms => new Promise(r => setTimeout(r, ms));
function docker(args, input) {
  try { return execFileSync('docker', args, { input, encoding: 'utf8', timeout: 180_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch (error) { throw new Error(`Docker operation ${args[0]} failed: ${String(error.stderr || error.message).slice(-2000)}`); }
}
export async function startStack() {
  const prefix = `david-integration-${randomBytes(6).toString('hex')}`;
  const names = { db: `${prefix}-db`, auth: `${prefix}-auth`, rest: `${prefix}-rest` };
  const secret = randomBytes(40).toString('hex');
  const password = randomBytes(24).toString('hex');
  const token = role => {
    const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 })}`;
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  };
  const sql = input => docker(['exec', '-i', names.db, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At'], input);
  let proxy;
  const close = async () => {
    if (proxy) await new Promise(r => proxy.close(r));
    for (const name of [names.rest, names.auth, names.db]) { try { docker(['rm', '-f', '-v', name]); } catch {} }
    try { docker(['network', 'rm', prefix]); } catch {}
  };
  try {
    docker(['network', 'create', prefix]);
    docker(['run', '--detach', '--name', names.db, '--network', prefix,
      '--tmpfs', '/var/lib/postgresql/data', '--env', `POSTGRES_PASSWORD=${password}`, images.postgres]);
    let databaseReady = false;
    for (let i=0;i<120;i++) {
      try { docker(['exec', names.db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); databaseReady = true; break; } catch { await wait(250); }
    }
    if (!databaseReady) throw new Error('Disposable PostgreSQL startup timed out');
    sql(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create role authenticator login noinherit password '${password}';
      grant anon, authenticated, service_role to authenticator;
      create role supabase_auth_admin login createrole password '${password}';
      create schema auth authorization supabase_auth_admin;
      grant all on database postgres to supabase_auth_admin;
      grant usage on schema public to anon, authenticated, service_role;
      grant usage on schema auth to anon, authenticated, service_role;
`);
    docker(['run', '--detach', '--name', names.auth, '--network', prefix,
      '--publish', '127.0.0.1::9999',
      '--env', 'GOTRUE_API_HOST=0.0.0.0', '--env', 'GOTRUE_API_PORT=9999',
      '--env', 'API_EXTERNAL_URL=http://127.0.0.1:9999', '--env', 'GOTRUE_SITE_URL=http://127.0.0.1:8000',
      '--env', 'GOTRUE_DB_DRIVER=postgres', '--env', 'GOTRUE_DB_NAMESPACE=auth',
      '--env', `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${password}@${names.db}:5432/postgres?search_path=auth`,
      '--env', `GOTRUE_JWT_SECRET=${secret}`, '--env', 'GOTRUE_JWT_EXP=3600',
      '--env', 'GOTRUE_JWT_AUD=authenticated', '--env', 'GOTRUE_JWT_ADMIN_ROLES=service_role',
      '--env', 'GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated', '--env', 'GOTRUE_DISABLE_SIGNUP=true',
      '--env', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=true', '--env', 'GOTRUE_MAILER_AUTOCONFIRM=true',
      images.auth]);
    const port = name => Number(docker(['port', name]).match(/127\.0\.0\.1:(\d+)/)?.[1]);
    const authPort = port(names.auth);
    let authReady = false;
    for (let i=0;i<120;i++) {
      try { if ((await fetch(`http://127.0.0.1:${authPort}/health`)).ok) { authReady=true; break; } } catch {}
      await wait(250);
    }
    if (!authReady) throw new Error(`Local Auth startup timed out: ${docker(['logs', names.auth]).slice(-3000)}`);
    // Auth's oldest migration creates auth.uid for legacy per-claim settings.
    // Current PostgREST uses request.jwt.claims, as in modern Supabase PostgreSQL.
    sql(`create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
      grant execute on function auth.uid() to anon, authenticated, service_role;`);
    for (const filename of readdirSync(resolve('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) {
      sql(readFileSync(resolve('supabase/migrations', filename), 'utf8'));
    }
    docker(['run', '--detach', '--name', names.rest, '--network', prefix,
      '--publish', '127.0.0.1::3000',
      '--env', `PGRST_DB_URI=postgres://authenticator:${password}@${names.db}:5432/postgres`,
      '--env', 'PGRST_DB_SCHEMAS=public', '--env', 'PGRST_DB_ANON_ROLE=anon',
      '--env', 'PGRST_DB_MAX_ROWS=1000',
      '--env', `PGRST_JWT_SECRET=${secret}`, '--env', 'PGRST_SERVER_PORT=3000', images.rest]);
    const restPort = port(names.rest);
    let restReady = false;
    for (let i=0;i<120;i++) {
      try { if ((await fetch(`http://127.0.0.1:${restPort}/`)).ok) { restReady=true; break; } } catch {}
      await wait(250);
    }
    if (!restReady) throw new Error('Local PostgREST startup timed out');
    proxy = createServer((incoming, outgoing) => {
      // This local gateway stands in for Supabase's API gateway (Kong).
      outgoing.setHeader('Access-Control-Allow-Origin', '*');
      outgoing.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version, range, range-unit');
      outgoing.setHeader('Access-Control-Expose-Headers', 'Content-Range, Range-Unit');
      outgoing.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      if (incoming.method === 'OPTIONS') { outgoing.writeHead(204); outgoing.end(); return; }
      const authRoute = incoming.url.startsWith('/auth/v1/');
      const restRoute = incoming.url.startsWith('/rest/v1/');
      if (!authRoute && !restRoute) { outgoing.writeHead(404); outgoing.end(); return; }
      const upstream = request({ hostname: '127.0.0.1', port: authRoute ? authPort : restPort,
        path: incoming.url.replace(authRoute ? '/auth/v1' : '/rest/v1', ''),
        method: incoming.method, headers: incoming.headers }, result => {
        outgoing.writeHead(result.statusCode, result.headers); result.pipe(outgoing);
      });
      upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
      incoming.pipe(upstream);
    });
    await new Promise(r => proxy.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${proxy.address().port}`, anonKey: token('anon'), serviceKey: token('service_role'), sql, close };
  } catch (error) { await close(); throw error; }
}
