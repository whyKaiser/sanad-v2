import {readFileSync} from 'node:fs';
const c=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(c.name!=='sanad-v2'||c.d1_databases?.length!==1||c.d1_databases[0].database_name!=='sanad-v2-db'||c.d1_databases[0].database_id==='f48962ab-dda6-409d-9bad-1b9c559c7511'||c.d1_databases[0].database_id.startsWith('00000000-'))throw Error('V2 isolation guard: refusing to target the original SANAD worker/database or an unconfigured database.');
console.log('Independent SANAD v2 worker and database verified.');
