import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../lib/sanad/password';
import { base, request, sessionCookie } from './session';
import { demoRecord } from '../lib/sanad/demo';
test('Password verifier uses salt, rejects wrong passwords and malformed hashes',async()=>{
  const password='synthetic-test-password-for-unit';const hash=await hashPassword(password);
  assert.equal(await verifyPassword(password,hash),true);assert.equal(await verifyPassword('another-synthetic-password',hash),false);assert.equal(await verifyPassword(password,'bad-format'),false);assert.notEqual(await hashPassword(password),hash);
});
test('Private routes reject former platform headers, old cookies and unauthenticated sessions',async()=>{
  assert.equal((await fetch(base+'/api/state',{headers:{cookie:'__sites_local_auth=1','oai-authenticated-user-id':'sanad:admin','oai-authenticated-user-email':'test@example.invalid'}})).status,401);
  const home=await fetch(base+'/',{redirect:'manual'});assert.ok([302,307].includes(home.status));assert.equal(new URL(home.headers.get('location')!,base).pathname,'/login');
  const login=await fetch(base+'/login');assert.equal(login.status,200);assert.ok(!(await login.text()).includes('/signin-with-chatgpt'));
});
test('Login rejects foreign origins and incorrect credentials; cookie is HttpOnly and SameSite',async()=>{
  const headers={'content-type':'application/json'};const body=JSON.stringify({username:'admin',password:'this-is-a-wrong-password'});
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{...headers,origin:'https://untrusted.example'},body})).status,403);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{...headers,origin:base},body})).status,401);
  assert.equal((await request('/api/state')).status,200);assert.match(await sessionCookie(),/^sanad_session=[a-f0-9]{64}$/);
});
test('A 5 MB synthetic file round-trips through chunked D1 storage and detects duplicates',async()=>{
  const {consularStatus,...input}=demoRecord(0);const created=await request('/api/cases','POST',{...input,name:'اختبار الملف المقسم'});assert.equal(created.status,201);const record:any=await created.json();
  const bytes=randomBytes(5*1024*1024);bytes.set(new TextEncoder().encode('%PDF-1.7\n% synthetic test bytes\n'));
  const fields={name:input.englishName,passportNumber:input.passportNumber,nationality:input.nationality,birthDate:input.birthDate,expiryDate:'2030-04-12'};
  function form(){const f=new FormData();f.set('file',new File([bytes],'chunk-test.pdf',{type:'application/pdf'}));for(const [k,v]of Object.entries({caseId:record.id,fields:JSON.stringify(fields),source:'اختبار تخزين اصطناعي',capturedAt:'2026-09-11',type:'passport',synthetic:'true',locations:'{}'}))f.set(k,v);return f;}
  const uploaded=await request('/api/documents','POST',form());assert.equal(uploaded.status,201,await uploaded.clone().text());const doc:any=await uploaded.json();
  const retrieved=await request(`/api/documents/${doc.id}/file`);assert.equal(retrieved.status,200);assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()),bytes);
  assert.equal((await request('/api/documents','POST',form())).status,409);
});
test('Logout revokes the exact issued session',async()=>{
  const credentials=JSON.parse(await readFile('work/login-private.json','utf8'));
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(credentials)});assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie')!;assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);const cookie=setCookie.split(';')[0];
  assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie,origin:base}})).status,200);
  assert.equal((await fetch(base+'/api/state',{headers:{cookie}})).status,401);
});
