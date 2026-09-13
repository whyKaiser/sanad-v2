import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,cpSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';
import {parseEnv} from 'node:util';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(config.name!=='sanad-v2'||config.d1_databases[0].database_name!=='sanad-v2-db')throw Error('Independent v2 configuration required');
const runId=String(Date.now());const persist=resolve('.wrangler/test-state',runId);mkdirSync(persist,{recursive:true});
const snapshot=resolve(persist,'artifact');cpSync('dist',snapshot,{recursive:true});
const testConfig=JSON.parse(readFileSync(resolve(snapshot,'server/wrangler.json'),'utf8'));
delete testConfig.configPath;delete testConfig.userConfigPath;
testConfig.name=`sanad-v2-test-${runId}`;testConfig.topLevelName=testConfig.name;
writeFileSync(resolve(snapshot,'server/wrangler.json'),JSON.stringify(testConfig));cpSync('.env',resolve(snapshot,'.env'));
const childEnv={...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false'};
async function run(args,stream=false){return new Promise((resolve,reject)=>{let output='';const child=spawn(process.execPath,args,{env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',d=>{output+=d;if(stream)process.stdout.write(d);});child.stderr.on('data',d=>{output+=d;if(stream)process.stderr.write(d);});child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error(stream?'Integration assertions failed; see results above.':output)));});}
await run([resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--persist-to',persist]);
// The test-mode API disables the shared dev registry and file watchers.
// Vite can stay open without swapping the test worker's downstream connection.
const moduleFiles=readdirSync(resolve(snapshot,'server'),{recursive:true}).filter(p=>/\.m?js$/.test(p));moduleFiles.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
const worker=new Miniflare({name:testConfig.name,modules:moduleFiles.map(p=>({type:'ESModule',path:resolve(snapshot,'server',p)})),modulesRoot:resolve(snapshot,'server'),compatibilityDate:testConfig.compatibility_date,compatibilityFlags:testConfig.compatibility_flags,bindings:parseEnv(readFileSync('.env','utf8')),d1Databases:{DB:config.d1_databases[0].database_id},d1Persist:resolve(persist,'v3/d1'),host:'127.0.0.1',port:0});
const base=(await worker.ready).origin;childEnv.SANAD_TEST_URL=base;childEnv.SANAD_TARGET_URL=base;console.log('Isolated compiled worker is ready.');
try{console.log((await run(['scripts/setup-demo.mjs'])).trim());await run(['--import','tsx','--test','--test-timeout=60000','--test-concurrency=1','tests/integration-suite.ts'],true);}
catch(error){console.error(error.message);process.exitCode=1;}
finally{await worker.dispose();console.log('Isolated test worker stopped. Demo database was not used.');}
