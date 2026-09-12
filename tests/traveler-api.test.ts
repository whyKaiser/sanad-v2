import test from "node:test";
import assert from "node:assert/strict";
import { request } from "./session";
import { demoRecord } from "../lib/sanad/demo";
import { demoDetails } from "../lib/sanad/traveler-demo";
import type { CaseRecord } from "../lib/sanad/types";

async function create() { const { consularStatus, ...input } = demoRecord(0); const response = await request('/api/cases', 'POST', { ...input, name: 'حالة خانات اصطناعية للاختبار' }); assert.equal(response.status, 201); return response.json() as Promise<CaseRecord>; }
test("Profile persists with revision control and preserves independent case notes", async () => {
  let r = await create(); const profile = demoDetails(r, 0).profile;
  let response = await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: 0, profile }); assert.equal(response.status, 200, await response.clone().text()); r = await response.json() as CaseRecord;
  assert.equal(r.details!.revision, 1); assert.equal(r.details!.profile.values.identityNumber, 'DEMO-ID-3001');
  response = await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: 0, profile }); assert.equal(response.status, 409);
  assert.equal((await request(`/api/cases/${r.id}`, 'PATCH', { notes: 'ملاحظة مستقلة للاختبار', consularStatus: 'under_review' })).status, 200);
  profile.values.visitorType = 'زائر اصطناعي معدل';
  response = await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: 1, profile }); assert.equal(response.status, 200); r = await response.json() as CaseRecord;
  assert.equal(r.notes, 'ملاحظة مستقلة للاختبار'); assert.equal(r.details!.revision, 2);
});
test("Travel persists, prevents duplicate references, blocks links outside the case, and cites the exact movement", async () => {
  let r = await create(); const { id, createdAt, updatedAt, ...movement } = demoDetails(r, 3).movements[0];
  const post = (revision: number, value = movement) => request(`/api/cases/${r.id}/travel`, 'POST', { revision, movement: value, setLatestEntry: true });
  movement.entry.documentId = 'sanad-test-foreign-doc'; assert.equal((await post(0)).status, 400); movement.entry.documentId = '';
  let response = await post(0); assert.equal(response.status, 201, await response.clone().text()); r = await response.json() as CaseRecord;
  assert.equal(r.details!.movements.length, 1); const movementId = r.details!.movements[0].id; assert.equal(r.details!.latestEntryId, movementId);
  assert.equal((await post(1)).status, 409);
  movement.entry.operatorNumber = 'DEMO-OP-EDIT';
  response = await request(`/api/cases/${r.id}/travel/${movementId}`, 'PATCH', { revision: 1, movement, setLatestEntry: true }); assert.equal(response.status, 200);
  assert.equal((await request(`/api/cases/${r.id}/travel/${movementId}`, 'PATCH', { revision: 1, movement, setLatestEntry: true })).status, 409);
  r = await (await request(`/api/cases/${r.id}`)).json() as CaseRecord; assert.equal(r.details!.movements[0].entry.operatorNumber, 'DEMO-OP-EDIT');
  const answer: any = await (await request('/api/assistant', 'POST', { caseId: r.id, query: 'اعرض آخر دخول وخروج' })).json(); assert.equal(answer.mode, 'direct'); assert.equal(answer.evidence[0].movementId, movementId);
  const html = await (await request(`/api/packet/${r.id}`)).text(); assert.match(html, /DEMO-OP-EDIT/); assert.match(html, /DEMO-OUT-7004/);
});
test("New profile and travel mutations enforce ownership and request validation", async () => {
  const r = await create(), sample = demoDetails(r, 0), { id, createdAt, updatedAt, ...movement } = sample.movements[0];
  assert.equal((await request('/api/cases/sanad-test-foreign-case/profile', 'PUT', { revision: 0, profile: sample.profile })).status, 404);
  assert.equal((await request('/api/cases/sanad-test-foreign-case/travel', 'POST', { revision: 0, movement, setLatestEntry: true })).status, 404);
  assert.equal((await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: 0, profile: sample.profile, unexpected: true })).status, 400);
  assert.equal((await request(`/api/cases/${r.id}/travel`, 'POST', { revision: 0, movement, setLatestEntry: true }, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request(`/api/cases/${r.id}/travel/unknown`, 'PATCH', { revision: 0, movement, setLatestEntry: false })).status, 404);
});
test("Concurrent first saves cannot overwrite one another", async () => {
  const r = await create(), p = demoDetails(r, 0).profile;
  const outcomes = await Promise.all([request(`/api/cases/${r.id}/profile`, 'PUT', { revision: 0, profile: p }), request(`/api/cases/${r.id}/profile`, 'PUT', { revision: 0, profile: { ...p, source: 'مصدر اصطناعي آخر' } })]);
  assert.deepEqual(outcomes.map(x => x.status).sort(), [200, 409]);
  const saved: any = await (await request(`/api/cases/${r.id}`)).json(); assert.equal(saved.details.revision, 1);
});
test("Reviewed packet freezes added profile and travel data despite later edits", async () => {
  const state: any = await (await request('/api/state')).json();
  let r: CaseRecord = state.cases.find((c: CaseRecord) => c.reference === 'SND-2026-0004'); assert.ok(r);
  const original = structuredClone(r.details!.profile), profile = structuredClone(original);
  profile.source = 'DEMO-SNAPSHOT-ORIGINAL';
  r = await (await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: r.details!.revision, profile })).json() as CaseRecord;
  const saved = await request(`/api/packet/${r.id}`, 'POST', {}); assert.equal(saved.status, 200); const snapshot: any = await saved.json();
  profile.source = 'DEMO-SNAPSHOT-CHANGED';
  r = await (await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: r.details!.revision, profile })).json() as CaseRecord;
  const html = await (await request(`/api/packet-snapshots/${snapshot.id}`)).text();
  assert.match(html, /DEMO-SNAPSHOT-ORIGINAL/); assert.ok(!html.includes('DEMO-SNAPSHOT-CHANGED')); assert.match(html, /DEMO-TR-4004/);
  assert.equal((await request(`/api/cases/${r.id}/profile`, 'PUT', { revision: r.details!.revision, profile: original })).status, 200);
});
