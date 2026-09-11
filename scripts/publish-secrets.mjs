import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const config = parseEnv(readFileSync('.env', 'utf8'));
const keys = ['SANAD_USERNAME', 'SANAD_PASSWORD_HASH', 'SANAD_DISPLAY_NAME', 'GROQ_API_KEY', 'GROQ_MODEL'];
if (!config.SANAD_USERNAME || !config.SANAD_PASSWORD_HASH) {
  throw new Error('Run npm run setup:login first.');
}
const values = Object.fromEntries(keys.filter(key => config[key]).map(key => [key, config[key]]));
const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'secret', 'bulk', '--config', 'wrangler.jsonc'], {
  input: JSON.stringify(values), encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024,
});
// Guard logs against accidental echoing by an upstream CLI version.
function redact(output) {
  let safe = output || '';
  for (const key of ['GROQ_API_KEY', 'SANAD_PASSWORD_HASH']) {
    if (values[key]) safe = safe.split(values[key]).join('[REDACTED]');
  }
  return safe;
}
process.stdout.write(redact(result.stdout));
process.stderr.write(redact(result.stderr));
if (result.error) throw new Error('Unable to start Wrangler. Check Node.js and dependencies.');
process.exit(result.status ?? 1);
