import test from "node:test";
import assert from "node:assert/strict";
import { emptyLeg, emptyProfile, emptyDetails, profileSchema, movementSchema, validRecordedDate, displayRecordedDate, answerTravelerQuery } from "../lib/sanad/traveler";
import { demoRecord } from "../lib/sanad/demo";
import { demoDetails } from "../lib/sanad/traveler-demo";
import { travelerPrintHtml } from "../lib/sanad/traveler-print";
import type { CaseRecord } from "../lib/sanad/types";
const record = (): CaseRecord => ({ ...demoRecord(0), id: "demo", reference: "DEMO-CASE", createdAt: "", updatedAt: "", documents: [], status: "needs_document" });

test("Dates preserve their calendar and reject impossible Gregorian dates", () => {
  assert.equal(validRecordedDate("2026-02-30", "gregorian"), false);
  assert.equal(validRecordedDate("2024-02-29", "gregorian"), true);
  assert.equal(validRecordedDate("1448-02-30", "hijri"), true);
  assert.equal(validRecordedDate("1448-13-10", "hijri"), false);
  assert.equal(validRecordedDate("1448-02-31", "hijri"), false);
  assert.match(displayRecordedDate({ value: "1448-02-10", calendar: "hijri" }), /1448-02-10.*هجري/);
});
test("Profile validates source, durations, capture date and same-calendar date order", () => {
  const p = emptyProfile(); p.source = "سجل اصطناعي";
  assert.ok(profileSchema.safeParse(p).success);
  p.values.remainingDays = "-3"; assert.ok(!profileSchema.safeParse(p).success);
  p.dates.remainingAsOf.value = "2026-09-12"; assert.ok(profileSchema.safeParse(p).success);
  p.values.visaDays = "-3"; assert.ok(!profileSchema.safeParse(p).success); p.values.visaDays = "90";
  p.dates.passportIssueDate.value = "2030-01-01"; p.dates.passportExpiryDate.value = "2029-01-01";
  assert.ok(!profileSchema.safeParse(p).success);
  assert.ok(!profileSchema.safeParse({ ...p, unexpected: true }).success);
});
test("Travel validates populated exits and same-calendar sequencing without converting Hijri", () => {
  const m = { reference: "DEMO-TR-1", visaNumber: "DEMO-V-1", source: "مصدر وهمي", entry: emptyLeg(), exit: emptyLeg() };
  m.entry.date.value = "2026-09-01"; assert.ok(movementSchema.safeParse(m).success);
  m.exit.operatorNumber = "DEMO-OP-1"; assert.ok(!movementSchema.safeParse(m).success);
  m.exit.date.value = "2026-08-01"; assert.ok(!movementSchema.safeParse(m).success);
  m.exit.date = { value: "1448-02-01", calendar: "hijri" }; assert.ok(movementSchema.safeParse(m).success);
  m.entry.time = "25:00"; assert.ok(!movementSchema.safeParse(m).success);
  m.entry.time = "09:15:00"; m.exit.time = "09:15"; m.exit.date = { ...m.entry.date }; assert.ok(movementSchema.safeParse(m).success);
});
test("Identifiers remain distinct and linked-document numbers are not silently rewritten", () => {
  const r = record(), d = demoDetails(r, 0, { passport: "synthetic-doc" });
  assert.notEqual(d.profile.values.identityNumber, r.borderNumber);
  assert.notEqual(d.movements[0].entry.operatorNumber, r.borderNumber);
  assert.notEqual(d.movements[0].entry.documentNumber, r.passportNumber);
  assert.equal(d.movements[0].entry.documentId, "synthetic-doc");
  assert.ok(profileSchema.safeParse(d.profile).success);
});
test("Travel answers cite the manually selected movement and do not infer current presence", () => {
  const r = record(); r.details = demoDetails(r, 0);
  const a = answerTravelerQuery(r, "وش آخر دخول وخروج؟")!;
  assert.match(a.text, /لا يثبت/); assert.equal(a.evidence[0].movementId, r.details.latestEntryId);
  r.details.latestEntryId = null;
  assert.match(answerTravelerQuery(r, "هل غادر؟")!.title, /لم يُحدد/);
  assert.equal(answerTravelerQuery(r, "هل الشخص مخالف بسبب مدة التأشيرة؟"), null);
  assert.equal(answerTravelerQuery(r, "اثبت جنسيته من السفر"), null);
  assert.equal(answerTravelerQuery(r, "اعرض جواز الدخول"), null);
  assert.equal(answerTravelerQuery(r, "ما الاختلاف بين الوثيقة وسجل الدخول؟"), null);
});
test("Visa answers work without a passport, disclose dated values, and exclude personal characteristics", () => {
  const r = record(); r.details = demoDetails(r, 0); r.details.profile.values.religion = "PRIVATE-FIELD-MARKER";
  const a = answerTravelerQuery(r, "اعرض بيانات التأشيرة")!;
  assert.match(a.text, /لا تمثل حسابًا آنيًا/); assert.ok(!JSON.stringify(a).includes("PRIVATE-FIELD-MARKER"));
  assert.ok(a.evidence.every(e => e.section === "record"));
});
test("Print handles legacy snapshots, includes travel data, and escapes all added text", () => {
  const r = record(); assert.match(travelerPrintHtml(r), /لم تُضف حركات/);
  r.details = demoDetails(r, 0); r.details.profile.values.address = '<script>alert("x")</script>';
  const html = travelerPrintHtml(r); assert.ok(!html.includes('<script>')); assert.match(html, /&lt;script&gt;/); assert.match(html, /DEMO-TR-4001/);
  assert.equal(emptyDetails().revision, 0);
});
