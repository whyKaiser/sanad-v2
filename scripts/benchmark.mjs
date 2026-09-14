import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

// Explicitly limited to v2 and loopback; never benchmarks the original SANAD.
const base=process.env.SANAD_TARGET_URL||'http://localhost:5174';
if(base!=='https://sanad-v2.songokualshareef.workers.dev'&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Only SANAD v2 or a loopback preview is permitted.');
const credentials=JSON.parse(readFileSync('work/login-private.json','utf8'));
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(30000)});
assert.equal(login.status,200,'Benchmark login failed');
const cookie=login.headers.get('set-cookie').split(';')[0];
async function request(path,method='GET'){
 const response=await fetch(base+path,{method,headers:{origin:base,cookie,'x-sanad-reason':encodeURIComponent('قياس تقني على ملف اصطناعي في سَنَد ٢')},signal:AbortSignal.timeout(30000)});
 assert.ok(response.ok,`${path.split('/')[2]}: HTTP ${response.status}`);return response;
}
try{
 const state=await(await request('/api/state')).json();
 const record=state.cases.find(c=>c.synthetic&&c.documents.length&&c.documents.every(d=>d.synthetic));
 assert.ok(record,'A synthetic document is required.');
 const operations=[['case_read',`/api/cases/${record.id}`],['document_download',`/api/documents/${record.documents[0].id}/file`],['packet_html',`/api/packet/${record.id}`]];
 const results=[];
 for(const [name,path] of operations){
  const samples=[];
  for(let i=0;i<5;i++){const start=performance.now();const response=await request(path);const bytes=await response.arrayBuffer();assert.ok(bytes.byteLength>0);samples.push(Math.round(performance.now()-start));}
  const sorted=[...samples].sort((a,b)=>a-b);
  results.push({operation:name,samplesMs:samples,medianMs:sorted[2],minMs:sorted[0],maxMs:sorted[4]});
 }
 const report={at:new Date().toISOString(),target:base,caseCount:state.cases.length,rounds:5,scope:'Elapsed API request and response download time including network. One synthetic case; sequential calls; no load test, UI rendering or field baseline. Does not measure waiting-time savings.',results};
 mkdirSync('work',{recursive:true});writeFileSync('work/benchmark-results.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await request('/api/auth/logout','POST');}
