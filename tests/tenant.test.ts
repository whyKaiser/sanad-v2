import test from 'node:test';
import assert from 'node:assert/strict';
import {base,request,sessionCookie} from './session';
test('Owner isolation covers case, original file, packet and assistant',async()=>{
 for(const path of ['/api/cases/sanad-test-foreign-case','/api/documents/sanad-test-foreign-doc/file','/api/packet-snapshots/sanad-test-foreign-packet'])assert.equal((await fetch(base+path,{headers:{cookie:await sessionCookie()}})).status,404,path);
 const response=await fetch(base+'/api/assistant',{method:'POST',headers:{cookie:await sessionCookie(),'content-type':'application/json'},body:JSON.stringify({caseId:'sanad-test-foreign-case',query:'اعرض الجواز',provider:'local'})});assert.equal(response.status,404);
});
test('Explicit question wording guards an inaccurate semantic classification',async()=>{
 const state:any=await(await fetch(base+'/api/state',{headers:{cookie:await sessionCookie()}})).json();const record=state.cases.find((c:any)=>c.reference==='SND-2026-0003');assert.ok(record);
 const response=await fetch(base+'/api/assistant',{method:'POST',headers:{cookie:await sessionCookie(),'content-type':'application/json'},body:JSON.stringify({caseId:record.id,query:'هل كتابة اسم صاحب الوثيقة مختلفة عن المسجل عند القدوم؟',intent:'nationality',semantic:true,provider:'local'})});assert.equal(response.status,200);assert.match((await response.json() as any).title,/اختلافات/);
});
