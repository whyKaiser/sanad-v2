import { z } from "zod";
import { dateString, fieldsSchema } from "./validation";
import { recordedDateSchema, emptyDate, normalizeDetails, type RecordedDate } from "./traveler";
import type { CaseRecord, StoredDocument, TravelFields } from "./types";

export const visaTypes = ["عمل", "حج", "عمرة", "زيارة", "زيارة عائلية", "زيارة شخصية", "زيارة تجارية", "سياحة", "زيارة استثنائية", "مرور", "أخرى"];
const short = z.string().trim().min(2).max(160);
const revision = z.number().int().min(1);
export const intakeSchema = z.object({ requestKey: z.string().uuid(), name: short, englishName: short, visaNumber: short.max(40), visaType: z.enum(visaTypes as [string, ...string[]]), issuer: short, capturedAt: dateString, fields: fieldsSchema, synthetic: z.literal(true) }).strict().refine(v => v.fields.birthDate && v.fields.birthDate < v.capturedAt, "تاريخ الميلاد يجب أن يسبق حفظ النسخة");
export type IntakeInput = z.infer<typeof intakeSchema>;
export const intakeStatuses = { saved: "حُفظت النسخة قبل الوصول", reviewed: "راجع الموظف النسخة", queued: "بانتظار الاستلام التجريبي", received: "استُلمت داخل النموذج", arrived: "رُبطت بسجل دخول" };
export type IntakeStatus = keyof typeof intakeStatuses;
export type IntakeFile = { filename: string; contentType: string; size: number; sha256: string; objectKey: string };
export type IntakeRecord = Omit<IntakeInput, "requestKey"> & { id: string; reference: string; revision: number; status: IntakeStatus; file: Omit<IntakeFile, "objectKey">; reviewNote: string; reviewedAt: string | null; createdAt: string; updatedAt: string; messageId: string | null; queuedAt: string | null; receivedAt: string | null; caseId: string | null };
export const intakeReviewSchema = z.object({ revision, fields: fieldsSchema, reviewNote: z.string().trim().min(8).max(2000) }).strict().refine(v => Object.values(v.fields).every(Boolean), "أكمل حقول الجواز قبل تسجيل المراجعة");
export const transitionSchema = z.object({ revision }).strict();
export const arrivalSchema = z.object({ revision, borderNumber: short.max(40), entryDate: dateString, time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/), port: short, transport: short, direction: short, carrier: short, operatorNumber: short.max(40), documentNumber: short.max(40), movementReference: short.max(80) }).strict();
export const directiveTypes = { entry_ban: "مرجع أمر منع دخول", removal: "مرجع أمر إبعاد", departure: "مرجع إجراء مغادرة" };
export const directiveSchema = z.object({ requestKey: z.string().uuid(), reference: short.max(80), type: z.enum(["entry_ban", "removal", "departure"]), source: short, date: recordedDateSchema, documentIds: z.array(z.string().min(1).max(80)).max(20).refine(ids => new Set(ids).size === ids.length, "الوثيقة مكررة"), notes: z.string().trim().max(2000), synthetic: z.literal(true) }).strict().refine(v => !!v.date.value, "تاريخ الأمر الوارد مطلوب");
export type DirectiveRecord = Omit<z.infer<typeof directiveSchema>, "requestKey"> & { id: string; caseId: string; revision: number; createdAt: string; preparedAt: string | null; snapshot: { documents: StoredDocument[]; caseReference: string; caseName: string } | null };
export const directiveUpdateSchema = directiveSchema.innerType().omit({ requestKey: true }).extend({ revision }).strict().refine(v => !!v.date.value, "تاريخ الأمر الوارد مطلوب");
export function directiveReadiness(record: CaseRecord, ids: string[]) {
  const selected = record.documents.filter(d => ids.includes(d.id));
  const missing: string[] = [];
  if (!selected.some(d => d.type === "passport")) missing.push("نسخة جواز مرتبطة");
  if (record.documents.some(d => d.type === "travel_document") && !selected.some(d => d.type === "travel_document")) missing.push("نسخة الوثيقة البديلة الموجودة في الملف");
  if (selected.some(d => d.reviewStatus !== "approved")) missing.push("إكمال مراجعة النسخ المرتبطة");
  if (ids.some(id => !record.documents.some(d => d.id === id))) missing.push("إزالة رابط لا يتبع هذا الملف");
  return { ready: missing.length === 0, missing, documents: selected };
}

export type FollowupStatus = "exit_recorded" | "deadline_passed" | "within_deadline" | "needs_data";
export const followupLabels: Record<FollowupStatus, string> = { exit_recorded: "خروج مسجل للحركة المحددة", deadline_passed: "موعد مضى دون خروج مرتبط — للمراجعة", within_deadline: "موعد المغادرة المسجل لم يمضِ", needs_data: "بيانات غير كافية للمقارنة" };
export function followupStatus(record: CaseRecord, asOf: RecordedDate): FollowupStatus {
  const details = normalizeDetails(record.details), m = details.movements.find(m => m.id === details.latestEntryId);
  if (!m || !asOf.value || m.entry.date.calendar !== asOf.calendar || m.entry.date.value > asOf.value) return "needs_data";
  if (m.exit.date.value) {
    if (m.exit.date.calendar !== asOf.calendar) return "needs_data";
    if (m.exit.date.value <= asOf.value) return "exit_recorded";
  }
  const due = details.profile.dates.departureDeadline || emptyDate();
  if (!due.value || due.calendar !== asOf.calendar || due.value < m.entry.date.value || !details.profile.source) return "needs_data";
  return due.value < asOf.value ? "deadline_passed" : "within_deadline";
}
export function recordAnalytics(records: CaseRecord[], asOf: RecordedDate, visaType = "all") {
  const selected = records.filter(r => visaType === "all" || r.visaType === visaType);
  const rows = selected.map(record => ({ record, status: followupStatus(record, asOf) }));
  const counts = Object.fromEntries(Object.keys(followupLabels).map(k => [k, rows.filter(r => r.status === k).length])) as Record<FollowupStatus, number>;
  const movements = selected.flatMap(r => normalizeDetails(r.details).movements);
  return { rows, counts, total: selected.length, entryRecords: movements.length, exitRecords: movements.filter(m => m.exit.date.value).length, missingExitRecords: movements.filter(m => !m.exit.date.value).length, visaCounts: [...new Set(selected.map(r => r.visaType))].map(type => ({ type, count: selected.filter(r => r.visaType === type).length })) };
}
// Every CSV cell is quoted, including cells containing a newline or a formula prefix.
export function csvCell(value: string) { const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }
export function analyticsCsv(records: CaseRecord[], asOf: RecordedDate, visaType = "all") {
  const data = recordAnalytics(records, asOf, visaType);
  const rows = [["مرجع الحالة", "الاسم التجريبي", "نوع التأشيرة", "حالة السجل للمراجعة", "تاريخ الرصد", "التقويم"], ...data.rows.map(({ record, status }) => [record.reference, record.name, record.visaType, followupLabels[status], asOf.value, asOf.calendar === "hijri" ? "هجري" : "ميلادي"])];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
