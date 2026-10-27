// Bundle only the official SDK. Keep the existing static application and config intact.
const { build } = require('esbuild');
const { writeFile, readFile } = require('node:fs/promises');
const { dirname, join } = require('node:path');
async function main() {
  await build({
    stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: process.cwd() },
    outfile: 'dist/vendor/supabase.js', bundle: true, minify: true,
    format: 'iife', globalName: 'supabase', platform: 'browser', target: ['es2022'],
    legalComments: 'eof'
  });
  // Preserve the SDK's upstream license alongside the distributable artifact.
  const sdkRoot = dirname(require.resolve('@supabase/supabase-js/package.json'));
  await writeFile('dist/vendor/SUPABASE-LICENSE', await readFile(join(sdkRoot, 'LICENSE')));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
