import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request, base } from './session';
import type { CaseRecord } from '../lib/sanad/types';
import { emptyProfile } from '../lib/sanad/traveler';
const fields = { name: 'OMAR SALEM', passportNumber: 'SND000101', nationality: 'UTO', birthDate: '1990-04-12', expiryDate: '2030-04-12' };
async function newRequest() {
  const metadata = { requestKey: crypto.randomUUID(), name: 'شخص اصطناعي قبل الوصول', englishName: 'OMAR SALEM', visaNumber: `DEMO-PRE-${crypto.randomUUID().slice(0, 8)}`, visaType: 'زيارة عائلية', issuer: 'جهة إصدار افتراضية', capturedAt: '2026-09-01', fields, synthetic: true };
  const bytes = await readFile('public/samples/passport-sample.png');
  function form(input = metadata) { const f = new FormData(); f.set('file', new File([bytes], 'specimen.png', { type: 'image/png' })); f.set('metadata', JSON.stringify(input)); return f; }
  const response = await request('/api/intake', 'POST', form()); assert.equal(response.status, 201, await response.clone().text()); return { row: await response.json() as any, metadata, form, bytes };
}
async function step(row: any, name: string) { const r = await request(`/api/intake/${row.id}/${name}`, name === 'review' ? 'PATCH' : 'POST', { revision: row.revision, ...(name === 'review' ? { fields, reviewNote: 'راجعت النسخة الاصطناعية وحقولها يدويًا' } : {}) }); assert.equal(r.status, 200, await r.clone().text()); return r.json() as Promise<any>; }
const arrival = (revision: number) => ({ revision, borderNumber: 'DEMO-B-PRE-TEST', entryDate: '2026-09-12', time: '09:15', port: 'منفذ اصطناعي', transport: 'جوًا', direction: 'جهة افتراضية', carrier: 'ناقل افتراضي', operatorNumber: 'DEMO-OP-TEST', documentNumber: 'DEMO-IN-TEST', movementReference: 'DEMO-TR-TEST' });
test('Pre-arrival persists a real file before a case exists, protects sequencing, and replays safely', async () => {
  const before: any = await (await request('/api/state')).json(), fixture = await newRequest(); let row = fixture.row;
  assert.ok(!JSON.stringify(row).includes('objectKey')); assert.equal(row.status, 'saved'); assert.equal(row.caseId, null);
  assert.equal((await (await request('/api/state')).json() as any).cases.length, before.cases.length);
  assert.deepEqual(Buffer.from(await (await request(`/api/intake/${row.id}/file`)).arrayBuffer()), fixture.bytes);
  assert.equal((await request('/api/intake', 'POST', fixture.form())).status, 200);
  assert.equal((await request('/api/intake', 'POST', fixture.form({ ...fixture.metadata, issuer: 'مختلفة' }))).status, 409);
  assert.equal((await request(`/api/intake/${row.id}/dispatch`, 'POST', { revision: row.revision })).status, 400);
  assert.equal((await request(`/api/intake/${row.id}/arrival`, 'POST', arrival(row.revision))).status, 400);
  row = await step(row, 'review');
  assert.equal((await request(`/api/intake/${row.id}/review`, 'PATCH', { revision: 1, fields, reviewNote: 'مراجعة قديمة لا ينبغي أن تستبدل الجديدة' })).status, 409);
  row = await step(row, 'dispatch'); const messageId = row.messageId; row = await step(row, 'dispatch'); assert.equal(row.messageId, messageId);
  row = await step(row, 'receive'); assert.equal((await step(row, 'receive')).messageId, messageId);
  const response = await request(`/api/intake/${row.id}/arrival`, 'POST', arrival(row.revision)); assert.equal(response.status, 201, await response.clone().text()); const record: CaseRecord = await response.json() as CaseRecord;
  assert.equal(record.documents[0].sha256, row.file.sha256); assert.deepEqual(Buffer.from(await (await request(`/api/documents/${record.documents[0].id}/file`)).arrayBuffer()), fixture.bytes);
  assert.equal(record.details!.movements[0].entry.documentId, record.documents[0].id); assert.equal(record.documents[0].capturedAt, '2026-09-01');
  const replay = await request(`/api/intake/${row.id}/arrival`, 'POST', arrival(row.revision)); assert.equal(replay.status, 200); assert.equal((await replay.json() as any).id, record.id);
  assert.equal((await request(`/api/intake/${row.id}/arrival`, 'POST', { ...arrival(row.revision), port: 'منفذ آخر' })).status, 409);
  assert.equal((await (await request('/api/state')).json() as any).cases.length, before.cases.length + 1);
  assert.equal((await request(`/api/intake/${row.id}/review`, 'PATCH', { revision: row.revision, fields, reviewNote: 'محاولة تعديل النسخة بعد تسليمها' })).status, 409);
});
test('New workflows reject unauthenticated users, foreign records, forged data, and foreign origins', async () => {
  assert.equal((await fetch(base + '/api/intake')).status, 401);
  assert.equal((await request('/api/intake/foreign/file')).status, 404);
  assert.equal((await request('/api/cases/sanad-test-foreign-case/directives')).status, 404);
  assert.equal((await request('/api/directives/foreign/print')).status, 404);
  const { row, form, metadata } = await newRequest();
  assert.equal((await request('/api/intake', 'POST', form({ ...metadata, requestKey: crypto.randomUUID(), synthetic: false } as any))).status, 400);
  assert.equal((await request(`/api/intake/${row.id}/dispatch`, 'POST', { revision: row.revision }, { origin: 'https://untrusted.example' })).status, 403);
});
test('Arrival cannot precede capture or create a second file for an existing visa', async () => {
  let { row } = await newRequest(); row = await step(await step(await step(row, 'review'), 'dispatch'), 'receive');
  assert.equal((await request(`/api/intake/${row.id}/arrival`, 'POST', { ...arrival(row.revision), entryDate: '2026-08-01' })).status, 400);
  const c = { name: 'ملف اصطناعي مكرر التأشيرة', englishName: 'SAMPLE PERSON', borderNumber: 'DEMO-B-CONFLICT', visaNumber: row.visaNumber, passportNumber: fields.passportNumber, nationality: 'UTO', birthDate: fields.birthDate, entryDate: '2026-09-10', visaType: 'زيارة', port: 'منفذ اصطناعي', notes: '', synthetic: true };
  assert.equal((await request('/api/cases', 'POST', c)).status, 201);
  assert.equal((await request(`/api/intake/${row.id}/arrival`, 'POST', arrival(row.revision))).status, 409);
});
test('Incoming directive drafts can fix missing document links and freeze both travel documents', async () => {
  const state: any = await (await request('/api/state')).json(), r: CaseRecord = state.cases.find((r: CaseRecord) => r.reference === 'SND-2026-0004'); assert.ok(r);
  const input = { requestKey: crypto.randomUUID(), reference: `DEMO-ORDER-${crypto.randomUUID().slice(0, 8)}`, type: 'entry_ban', source: 'مرجع افتراضي للاختبار', date: { value: '2026-09-01', calendar: 'gregorian' }, documentIds: [] as string[], notes: '<script>unsafe synthetic text</script>', synthetic: true };
  assert.equal((await request(`/api/cases/${r.id}/directives`, 'POST', { ...input, documentIds: ['sanad-test-foreign-doc'] })).status, 400);
  const created = await request(`/api/cases/${r.id}/directives`, 'POST', input); assert.equal(created.status, 201); let order: any = await created.json();
  assert.equal((await request(`/api/cases/${r.id}/directives`, 'POST', input)).status, 200);
  assert.equal((await request(`/api/directives/${order.id}/prepare`, 'POST', { revision: order.revision })).status, 400);
  const { requestKey, ...updated } = input; const patched = await request(`/api/directives/${order.id}`, 'PATCH', { ...updated, documentIds: r.documents.map(d => d.id), revision: order.revision }); assert.equal(patched.status, 200); order = await patched.json();
  assert.equal((await request(`/api/directives/${order.id}`, 'PATCH', { ...updated, revision: 1 })).status, 409);
  const prepared = await request(`/api/directives/${order.id}/prepare`, 'POST', { revision: order.revision }); assert.equal(prepared.status, 200); order = await prepared.json(); assert.equal(order.snapshot.documents.length, 2); assert.ok(order.preparedAt);
  assert.equal((await request(`/api/directives/${order.id}`, 'PATCH', { ...updated, revision: order.revision })).status, 409);
  const html = await (await request(`/api/directives/${order.id}/print`)).text(); assert.match(html, /&lt;script&gt;/); assert.ok(!html.includes('<script>unsafe')); assert.match(html, /لا يصدر أو ينفذ/); assert.ok(html.includes('SND-TD-1003'));
  const profile = emptyProfile(); profile.source = 'مصدر اصطناعي'; profile.dates.departureDeadline = { value: '2026-09-10', calendar: 'gregorian' };
  assert.equal((await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: r.details!.revision, profile })).status, 200);
  const current = await (await request(`/api/cases/${r.id}`)).json() as CaseRecord;
  assert.equal((await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: current.details!.revision, profile: r.details!.profile })).status, 200);
});
