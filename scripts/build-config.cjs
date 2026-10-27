// Only an allowlisted public configuration is emitted. Never serialize process.env.
const { writeFileSync } = require('node:fs');
const { validatePublicConfig } = require('../dist/auth.js');

function publicConfig(env) {
  const mode = env.DAVID_MODE || 'demo';
  const config = {
    mode,
    supabaseUrl: env.SUPABASE_URL || '',
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || ''
  };
  if (!['demo', 'production'].includes(mode)) throw Error('DAVID_MODE debe ser demo o production.');
  if (mode === 'production') validatePublicConfig(config);
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
