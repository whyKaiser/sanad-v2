import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeSchema, directiveReadiness, followupStatus, recordAnalytics, csvCell, analyticsCsv } from '../lib/sanad/operations';
import { emptyDetails, normalizeDetails } from '../lib/sanad/traveler';
import { demoRecord } from '../lib/sanad/demo';
import { demoDetails } from '../lib/sanad/traveler-demo';
import type { CaseRecord, StoredDocument } from '../lib/sanad/types';
const record = (i = 0): CaseRecord => { const r = { ...demoRecord(i), id: `CASE-${i}`, reference: `DEMO-${i}`, createdAt: '', updatedAt: '', documents: [], status: 'needs_document' as const }; return { ...r, details: demoDetails(r, i) }; };
const asOf = { value: '2026-09-12', calendar: 'gregorian' as const };
test('Legacy details gain empty deadline fields without inventing values', () => {
  const d = emptyDetails(); delete (d.profile.dates as any).departureDeadline;
  assert.equal(normalizeDetails(d).profile.dates.departureDeadline.value, '');
  assert.equal(followupStatus(record(), asOf), 'needs_data');
});
test('Visa expiry does not create a departure deadline or a violation classification', () => {
  const r = record(); r.details!.profile.dates.visaExpiryDate.value = '2020-01-01';
  assert.equal(followupStatus(r, asOf), 'needs_data');
  r.details!.profile.dates.departureDeadline = { value: '2026-09-11', calendar: 'gregorian' };
  assert.equal(followupStatus(r, asOf), 'deadline_passed');
  r.details!.profile.dates.departureDeadline.value = '2026-09-12'; assert.equal(followupStatus(r, asOf), 'within_deadline');
});
test('Mixed calendars, absent latest-entry selection, and impossible deadline order remain unknown', () => {
  const r = record(); r.details!.profile.dates.departureDeadline = { value: '1448-02-01', calendar: 'hijri' };
  assert.equal(followupStatus(r, asOf), 'needs_data');
  r.details!.profile.dates.departureDeadline = { value: '2026-08-01', calendar: 'gregorian' }; assert.equal(followupStatus(r, asOf), 'needs_data');
  r.details!.latestEntryId = null; assert.equal(followupStatus(r, asOf), 'needs_data');
});
test('Exit records are scoped to the selected movement and observation date', () => {
  const r = record(3); assert.equal(followupStatus(r, asOf), 'exit_recorded');
  r.details!.movements[0].exit.date = { value: '1448-03-01', calendar: 'hijri' }; assert.equal(followupStatus(r, asOf), 'needs_data');
  r.details!.movements[0].exit.date = { value: '2026-09-20', calendar: 'gregorian' }; assert.notEqual(followupStatus(r, asOf), 'exit_recorded');
  assert.equal(followupStatus(r, { ...asOf, value: '2026-08-01' }), 'needs_data');
});
test('Analytics count files and movements separately and honor visa filters', () => {
  const a = record(), b = record(3); a.visaType = 'زيارة عائلية'; b.visaType = 'عمل'; a.details!.movements.push({ ...a.details!.movements[0], id: 'another', reference: 'DEMO-ANOTHER' });
  const all = recordAnalytics([a, b], asOf); assert.equal(all.total, 2); assert.equal(all.entryRecords, 3); assert.equal(all.exitRecords, 1); assert.equal(all.missingExitRecords, 2);
  assert.equal(recordAnalytics([a, b], asOf, 'عمل').total, 1); assert.equal(Object.values(all.counts).reduce((a, b) => a + b, 0), 2);
});
test('CSV neutralizes formula prefixes and quotes newlines and delimiters', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"'); assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"'); assert.equal(csvCell('  @cmd'), '"\'  @cmd"');
  const r = record(); r.name = '=FAKE()'; assert.ok(analyticsCsv([r], asOf).includes("'=FAKE()"));
});
test('Order document readiness requires the original and any available replacement with human review', () => {
  const r = record(); const passport = { id: 'p', type: 'passport', reviewStatus: 'approved' } as StoredDocument, replacement = { id: 't', type: 'travel_document', reviewStatus: 'pending' } as StoredDocument;
  r.documents = [passport, replacement]; assert.equal(directiveReadiness(r, ['t']).ready, false); assert.equal(directiveReadiness(r, ['p']).ready, false); assert.equal(directiveReadiness(r, ['p', 't']).ready, false);
  replacement.reviewStatus = 'approved'; assert.equal(directiveReadiness(r, ['p', 't']).ready, true); assert.equal(directiveReadiness(r, ['p', 't', 'foreign']).ready, false);
});
test('Intake validation requires synthetic data and a birth date preceding capture', () => {
  const data = { requestKey: crypto.randomUUID(), name: 'شخص وهمي', englishName: 'SAMPLE PERSON', visaNumber: 'DEMO-V-01', visaType: 'زيارة شخصية', issuer: 'جهة افتراضية', capturedAt: '2026-09-11', fields: { name: 'SAMPLE PERSON', passportNumber: 'DEMO-P-01', nationality: 'UTO', birthDate: '1990-01-01', expiryDate: '2030-01-01' }, synthetic: true };
  assert.ok(intakeSchema.safeParse(data).success); assert.ok(!intakeSchema.safeParse({ ...data, synthetic: false }).success); assert.ok(!intakeSchema.safeParse({ ...data, status: 'arrived' }).success);
  assert.ok(!intakeSchema.safeParse({ ...data, fields: { ...data.fields, birthDate: '2027-01-01' } }).success);
});
