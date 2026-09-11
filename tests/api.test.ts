import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {demoRecord} from '../lib/sanad/demo';
import {base,request} from './session';
test('Unauthenticated and forged-header requests are denied',async()=>{assert.equal((await fetch(base+'/api/state')).status,401);assert.equal((await fetch(base+'/api/state',{headers:{'oai-authenticated-user-id':'local_seedy'}})).status,401);});
test('Cross-origin mutation is rejected',async()=>assert.equal((await request('/api/cases','POST',{}, {origin:'https://untrusted.example'})).status,403));
test('Document lifecycle, duplicate, stale edit, packet snapshot, and persistence',async()=>{
 const {consularStatus,...input}=demoRecord(0);
 const created=await request('/api/cases','POST',{...input,name:'حالة اختبار آلي',notes:'SANAD AUTOMATED TEST'});assert.equal(created.status,201);const record:any=await created.json();
 assert.equal((await request(`/api/packet/${record.id}`,'POST',{})).status,400);
 const missing:any=await (await request('/api/assistant','POST',{caseId:record.id,query:'اعرض الجواز'})).json();assert.match(missing.text,/لا يمكن استعادة/);
 const png=await readFile('public/samples/passport-sample.png');const fields={name:input.englishName,passportNumber:input.passportNumber,nationality:input.nationality,birthDate:input.birthDate,expiryDate:'2030-04-12'};
 function form(bytes:Uint8Array,name='sample.png'){const f=new FormData();f.set('file',new File([bytes as BlobPart],name,{type:'image/png'}));for(const [k,v]of Object.entries({caseId:record.id,fields:JSON.stringify(fields),source:'اختبار آلي اصطناعي',capturedAt:'2026-09-11',type:'passport',synthetic:'true',locations:'{}'}))f.set(k,v);return f;}
 assert.equal((await request('/api/documents','POST',form(new TextEncoder().encode('<script>bad</script>')))).status,415);
 const added=await request('/api/documents','POST',form(png));assert.equal(added.status,201);const doc:any=await added.json();assert.equal((await request('/api/documents','POST',form(png))).status,409);
 const file=await request(`/api/documents/${doc.id}/file`);assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'image/png');assert.equal((await file.arrayBuffer()).byteLength,png.length);
 const review={fields,reviewStatus:'approved',reviewNote:'مراجعة بيانات عينة آلية',revision:1};const reviewed=await request(`/api/documents/${doc.id}`,'PATCH',review);assert.equal(reviewed.status,200);assert.equal((await reviewed.json() as any).status,'ready');
 assert.equal((await request(`/api/documents/${doc.id}`,'PATCH',review)).status,409);
 const packet=await request(`/api/packet/${record.id}`,'POST',{});assert.equal(packet.status,200);const saved:any=await packet.json();
 const before=await (await request(`/api/packet-snapshots/${saved.id}`)).text();assert.match(before,/سُجلت مراجعة هذه الحزمة/);
 assert.equal((await request(`/api/cases/${record.id}`,'PATCH',{notes:'<script>window.XSS=1</script>',consularStatus:'under_review'})).status,200);
 const draft=await (await request(`/api/packet/${record.id}`)).text();assert.ok(draft.includes('&lt;script&gt;window.XSS=1&lt;/script&gt;'));assert.ok(!draft.includes('<script>window.XSS=1</script>'));
 const after=await (await request(`/api/packet-snapshots/${saved.id}`)).text();assert.equal(before,after,'A reviewed snapshot must stay unchanged');
 const state:any=await (await request('/api/state')).json();assert.ok(state.cases.some((x:any)=>x.id===record.id&&x.documents.length===1));assert.ok(state.audit.some((x:any)=>x.caseId===record.id&&x.action==='packet_reviewed'));
 console.log('Created synthetic integration-test case:',record.id);
});
