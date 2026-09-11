import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const port = args.some(value => value === '--port' || value.startsWith('--port=')) ? [] : ['--port', '5173'];
const child = spawn(process.execPath, [
  resolve('node_modules/wrangler/bin/wrangler.js'), 'dev',
  '--config', resolve('dist/server/wrangler.json'),
  '--env-file', resolve('.env'), '--local',
  '--persist-to', resolve('.wrangler/state'), '--ip', '127.0.0.1',
  ...port, ...args,
], { stdio: 'inherit', env: process.env });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('Unable to start the preview. Run npm run build first.'); process.exitCode = 1; });
