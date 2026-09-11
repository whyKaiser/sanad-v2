import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
if(!fs.existsSync('dist/server/wrangler.json'))throw Error('Run npm run build before initializing the local database.');
// Only initializes the initial schema. Production migrations are handled by Sites.
fs.mkdirSync('work',{recursive:true});
const sql=fs.readFileSync('drizzle/0000_bizarre_night_nurse.sql','utf8').replace(/CREATE TABLE /g,'CREATE TABLE IF NOT EXISTS ').replace(/CREATE UNIQUE INDEX /g,'CREATE UNIQUE INDEX IF NOT EXISTS ').replace(/CREATE INDEX /g,'CREATE INDEX IF NOT EXISTS ');
fs.writeFileSync('work/init-local.sql',sql);
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file','work/init-local.sql'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}});
process.exit(result.status??1);
