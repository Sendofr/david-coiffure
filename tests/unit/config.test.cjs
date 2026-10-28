const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { validatePublicConfig, resolveConfig, createClient } = require('../../dist/auth.js');
const { publicConfig } = require('../../scripts/build-config.cjs');

const valid = { mode: 'production', supabaseUrl: 'https://test-project.supabase.co', supabasePublishableKey: 'sb_publishable_this_is_a_test_public_key' };
const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.test-signature';

test('configuration generation allowlists public variables only', () => {
  const actual = publicConfig({ ...{ DAVID_MODE: 'production', SUPABASE_URL: valid.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: valid.supabasePublishableKey }, PRIVATE_TOKEN: 'must-not-appear', SUPABASE_SERVICE_ROLE_KEY: 'must-not-appear' });
  assert.deepEqual(actual, valid);
  assert.doesNotMatch(JSON.stringify(actual), /must-not-appear|PRIVATE_TOKEN|SERVICE_ROLE/);
});
test('demo is explicit and needs no credentials', () => {
  assert.equal(publicConfig({}).mode, 'demo');
  assert.equal(resolveConfig({ mode: 'demo' }).mode, 'demo');
  assert.throws(() => publicConfig({ DAVID_MODE: 'typo' }));
  assert.throws(() => publicConfig({ SUPABASE_URL: valid.supabaseUrl }));
});
test('Netlify requires an explicit mode and refuses local production endpoints', () => {
  assert.throws(() => publicConfig({ NETLIFY: 'true' }), /DAVID_MODE/);
  assert.equal(publicConfig({ NETLIFY: 'true', DAVID_MODE: 'demo' }).mode, 'demo');
  assert.throws(() => publicConfig({ NETLIFY: 'true', DAVID_MODE: 'production', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: valid.supabasePublishableKey }), /HTTPS/);
  assert.equal(publicConfig({ NETLIFY: 'true', DAVID_MODE: 'production', SUPABASE_URL: valid.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).mode, 'production');
});
test('production missing either public setting fails closed', () => {
  for (const config of [{ mode: 'production' }, { ...valid, supabaseUrl: '' }, { ...valid, supabasePublishableKey: '' }, { mode: 'typo' }]) {
    const result = resolveConfig(config, { mode: 'demo' });
    assert.equal(result.mode, 'production');
    assert.ok(result.error);
  }
  assert.throws(() => publicConfig({ DAVID_MODE: 'production' }));
});
test('browser storage cannot replace a pinned production project or downgrade it', () => {
  const result = resolveConfig(valid, { mode: 'demo', url: 'https://attacker.supabase.co', key: valid.supabasePublishableKey });
  assert.equal(result.url, valid.supabaseUrl);
  assert.equal(result.mode, 'production');
  assert.equal(result.error, null);
});
test('legacy admin JWT, access JWT and secret key are rejected before client construction', () => {
  for (const key of ['sb_secret_do_not_use', jwt('service_role'), jwt('authenticated'), 'arbitrary-text']) {
    assert.throws(() => validatePublicConfig({ ...valid, supabasePublishableKey: key }));
  }
  assert.equal(validatePublicConfig({ ...valid, supabasePublishableKey: jwt('anon') }).key, jwt('anon'));
});
test('cloud URLs reject credentials, paths, alternate schemes and lookalike hosts', () => {
  for (const url of ['http://test.supabase.co', 'https://test.supabase.co.evil.test', 'https://user:password@test.supabase.co', 'https://test.supabase.co/path', 'https://test.supabase.co?key=x', 'https://test.supabase.co#x', 'javascript:alert(1)']) {
    assert.throws(() => validatePublicConfig({ ...valid, supabaseUrl: url }));
  }
  assert.equal(validatePublicConfig({ ...valid, supabaseUrl: 'http://127.0.0.1:54321' }).url, 'http://127.0.0.1:54321');
});

test('a reload during pending logout discards the old SDK session before constructing a client', () => {
  const storageKey = 'david-auth-test-project.supabase.co';
  const entries = new Map([[storageKey, 'old-session'], [storageKey + '-logout', 'pending']]);
  const previousSdk = globalThis.supabase, previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: key => entries.get(key) || null, removeItem: key => entries.delete(key) };
  globalThis.supabase = { createClient: (_url, _key, options) => {
    assert.equal(entries.has(storageKey), false, 'old session must be removed before SDK reads it');
    assert.equal(options.auth.storageKey, storageKey);
    assert.equal(options.auth.autoRefreshToken, true);
    return 'new-client';
  } };
  try { assert.equal(createClient({ url: valid.supabaseUrl, key: valid.supabasePublishableKey }), 'new-client'); }
  finally { globalThis.supabase = previousSdk; globalThis.sessionStorage = previousStorage; }
});

test('config command emits a static public artifact and invalid production preserves the prior file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'david-config-'));
  const script = resolve('scripts/build-config.cjs');
  mkdirSync(join(directory, 'dist'));
  try {
    const generated = spawnSync(process.execPath, [script], { cwd: directory, env: { DAVID_MODE: 'production', SUPABASE_URL: valid.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: valid.supabasePublishableKey }, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const contents = readFileSync(join(directory, 'dist/config.js'), 'utf8');
    assert.ok(contents.includes(valid.supabaseUrl));
    const failed = spawnSync(process.execPath, [script], { cwd: directory, env: { DAVID_MODE: 'production' }, encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(readFileSync(join(directory, 'dist/config.js'), 'utf8'), contents);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
