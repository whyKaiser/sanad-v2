import { emptyDetails, emptyLeg, type CaseDetails } from "./traveler";
import type { CaseRecord } from "./types";

export function demoDetails(record: Pick<CaseRecord, "visaNumber" | "passportNumber" | "entryDate" | "port">, index: number, documentIds: { passport?: string; travel_document?: string } = {}): CaseDetails {
  const details = emptyDetails(), p = details.profile;
  p.source = "سجل اصطناعي أنشئ للعرض — لا يتبع أي شخص حقيقي";
  Object.assign(p.values, { identityNumber: `DEMO-ID-300${index + 1}`, visitorType: "زائر تجريبي", recordStatus: "قيمة تجريبية", description: "بيانات مصطنعة لعرض الخانات", travelRecordNumber: `DEMO-TR-400${index + 1}`, documentType: "جواز سفر", passportType: "عادي — مثال", passportIssuePlace: "جهة إصدار وهمية", visaTrips: "سفرة واحدة — مثال", visaIssuePlace: "قناة تأشيرات تجريبية", visaDays: "90", stayDays: "30", remainingDays: "12", employerNumber: `DEMO-E-500${index + 1}`, employerName: "جهة عمل افتراضية", address: "مدينة افتراضية — عنوان للعرض فقط" });
  p.dates.passportIssueDate = { value: "2025-04-12", calendar: "gregorian" };
  p.dates.passportExpiryDate = { value: "2030-04-12", calendar: "gregorian" };
  p.dates.visaIssueDate = { value: "2026-08-01", calendar: "gregorian" };
  p.dates.visaExpiryDate = { value: "2026-10-30", calendar: "gregorian" };
  p.dates.remainingAsOf = { value: `2026-08-${String(28 + index % 3).padStart(2, "0")}`, calendar: "gregorian" };
  const id = crypto.randomUUID();
  const entry = { ...emptyLeg(), date: { value: record.entryDate, calendar: "gregorian" as const }, time: "09:15:00", documentNumber: `DEMO-IN-600${index + 1}`, transport: "جوًا", direction: "جهة سفر افتراضية", carrier: "ناقل افتراضي · DEMO-01", location: record.port, operatorNumber: `DEMO-OP-IN-${index + 1}`, documentId: documentIds.passport || "" };
  const exit = index === 3 ? { ...emptyLeg(), date: { value: "2026-09-01", calendar: "gregorian" as const }, time: "17:30:00", documentNumber: "DEMO-OUT-7004", transport: "جوًا", direction: "وجهة افتراضية", carrier: "ناقل افتراضي · DEMO-02", location: "منفذ خروج تجريبي", operatorNumber: "DEMO-OP-OUT-4", documentId: documentIds.travel_document || "" } : emptyLeg();
  details.movements = [{ id, reference: p.values.travelRecordNumber, visaNumber: record.visaNumber, source: "حركة مصطنعة لشرح النموذج", entry, exit, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  details.latestEntryId = id;
  return details;
}
