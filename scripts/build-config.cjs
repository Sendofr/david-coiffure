// Only an allowlisted public configuration is emitted. Never serialize process.env.
const { writeFileSync } = require('node:fs');
const { validatePublicConfig } = require('../dist/auth.js');

function publicConfig(env) {
  const host = env.NETLIFY === 'true' ? 'Netlify' : env.VERCEL === '1' ? 'Vercel' : '';
  if (host && !env.DAVID_MODE) throw Error(host + ' requiere DAVID_MODE explícito: production o demo.');
  const mode = env.DAVID_MODE || 'demo';
  const config = {
    mode,
    supabaseUrl: env.SUPABASE_URL || '',
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
    bookingTurnstileSiteKey: (env.BOOKING_TURNSTILE_SITE_KEY || '').trim()
  };
  if (!['demo', 'production'].includes(mode)) throw Error('DAVID_MODE debe ser demo o production.');
  if (config.bookingTurnstileSiteKey && !/^[A-Za-z0-9_-]{20,100}$/.test(config.bookingTurnstileSiteKey)) {
    throw Error('BOOKING_TURNSTILE_SITE_KEY debe ser la site key pública del widget Turnstile.');
  }
  if (mode === 'production') {
    validatePublicConfig(config);
    if (host && new URL(config.supabaseUrl).protocol !== 'https:') {
      throw Error(host + ' requiere la URL HTTPS del proyecto alojado; no usar localhost.');
    }
  }
  else if (config.supabaseUrl || config.supabasePublishableKey) {
    throw Error('Para usar Supabase indicá explícitamente DAVID_MODE=production.');
  }
  return config;
}
if (require.main === module) {
  try {
    const config = publicConfig(process.env);
    writeFileSync('dist/config.js', '/* Generated PUBLIC configuration. Contains no private credentials. */\nwindow.DAVID_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n');
    console.log('Public configuration generated for mode: ' + config.mode);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { publicConfig };
