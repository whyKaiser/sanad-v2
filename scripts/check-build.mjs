import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

// Cloudflare's Vite plugin generates local-only secret files beside the worker.
// Deployment uses runtime secrets; keep generated deployment output secret-free.
const config = fs.existsSync('.env') ? parseEnv(fs.readFileSync('.env', 'utf8')) : {};
const secrets = ['GROQ_API_KEY', 'SANAD_PASSWORD_HASH'].map(key => config[key]).filter(Boolean).map(value => Buffer.from(value));
function check(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) { check(filename); continue; }
    if (item.name === '.dev.vars') { fs.unlinkSync(filename); continue; }
    const content = fs.readFileSync(filename);
    if (secrets.some(secret => content.includes(secret))) throw new Error(`Private runtime value detected in build file: ${filename}`);
  }
}
check('dist');
console.log('Build checked: runtime secrets are excluded from deployment files.');
