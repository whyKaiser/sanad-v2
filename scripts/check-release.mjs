import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';
const env=existsSync('.env')?parseEnv(readFileSync('.env','utf8')):{};
const secrets=['GROQ_API_KEY','SANAD_PASSWORD_HASH','SANAD_AUDIT_KEY'].map(k=>env[k]).filter(Boolean);
for(const path of ['work/login-private.json','work/team-private.json'])if(existsSync(path)){const value=JSON.parse(readFileSync(path,'utf8'));for(const row of Array.isArray(value)?value:[value])if(row.password)secrets.push(row.password);}
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
function containsPrivateValue(data,value){
 if(value.length>=16)return data.includes(Buffer.from(value));
 // Short demo credentials can occur inside numeric alphabets in vendor WASM.
 // Still reject standalone literals; full keys and password hashes use byte matching.
 const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(data.toString('utf8'));
}
for(const file of files){if(!existsSync(file))continue;if(/(^|\/)(\.env($|\.(?!example$))|(?:work|\.wrangler)(?:\/|$)|\.dev\.vars)/.test(file))throw Error('Private file included: '+file);const data=readFileSync(file);if(secrets.some(value=>containsPrivateValue(data,value)))throw Error('Private value included: '+file);}
console.log(`Release source scan passed: ${files.length} files; private runtime values and account passwords excluded.`);
