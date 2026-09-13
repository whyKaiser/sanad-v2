import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const base=process.env.SANAD_TARGET_URL||'http://localhost:5174';
const originalFetch=globalThis.fetch;globalThis.fetch=(url,options)=>originalFetch(url,{...options,signal:AbortSignal.timeout(30000)});
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)&&base!=='https://sanad-v2.songokualshareef.workers.dev')throw Error('Only the independent v2 target is permitted.');
const credentials=JSON.parse(readFileSync('work/login-private.json','utf8'));
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(credentials)});
if(!login.ok)throw Error('Demo login failed: '+login.status);
const cookie=login.headers.get('set-cookie').split(';')[0];
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{origin:base,cookie,'content-type':'application/json','x-sanad-reason':encodeURIComponent('تهيئة حالات اصطناعية لعرض مسار الدمج')},body:body?JSON.stringify(body):undefined});const result=await r.json();if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${result.error}`);return result;}
const known=existsSync('work/team-private.json')?JSON.parse(readFileSync('work/team-private.json','utf8')):[];
let users=await api('/api/users');
for(const [username,displayName,role] of [['officer','موظف المعالجة التجريبي','officer'],['reviewer','مشرف المراجعة التجريبي','reviewer'],['viewer','عضو العرض التجريبي','viewer']]){
 if(!users.some(u=>u.username===username)){
  const saved=known.find(u=>u.username===username);const password=saved?.password||randomBytes(24).toString('base64url');
  await api('/api/users','POST',{username,displayName,role,password});if(!saved)known.push({username,password,role});
 }
}
writeFileSync('work/team-private.json',JSON.stringify(known,null,2));
writeFileSync('work/team-private.txt',['سَنَد ٢ — حسابات العرض الخاصة',`الرابط: ${base}`,'',`المسؤول: ${credentials.username}`,`كلمة المرور: ${credentials.password}`,...known.flatMap(u=>['',`${u.role}: ${u.username}`,`كلمة المرور: ${u.password}`]),'','ملف خاص مستثنى من Git ومن الحزمة العامة.'].join('\n'));
let state=await api('/api/state');if(!state.cases.length)state=await api('/api/demo','POST',{});
users=await api('/api/users');const officer=users.find(u=>u.role==='officer');
const demo=state.cases.filter(c=>/^SND-2026-000[1-6]$/.test(c.reference)).sort((a,b)=>a.reference.localeCompare(b.reference));
for(let i=0;i<demo.length;i++){
 const c=demo[i];const w=await api(`/api/workflow/${c.id}`);if(w.revision)continue;
 const stage=i===1?'external_wait':c.status==='ready'?'ready':c.status==='needs_document'?'intake':'review';
 const reasons={external_wait:'بانتظار رد الجهة القنصلية الافتراضية على طلب الاستكمال',ready:'راجع المشرف النسخ الاصطناعية واعتمد جاهزية الملف التجريبي',intake:'نسخة الجواز غير متاحة؛ متابعة استكمال المستند من مصدره',review:'مراجعة الاختلافات بين الوثيقة وبيانات دخول الحالة الاصطناعية'};
 await api(`/api/workflow/${c.id}`,'PATCH',{revision:0,stage,reason:reasons[stage],assignee:officer?.id||'',expectedDays:3});
}
const integrity=await api('/api/journal');if(!integrity.integrity.valid)throw Error('Demo integrity verification failed');
console.log(`V2 demo ready: ${demo.length} cases, ${users.length} accounts, ${integrity.integrity.total} verified changes. Credentials saved privately; no values printed.`);
