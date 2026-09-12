import type { CaseRecord } from "./types";
import { escapeHtml as e } from "./domain";
import { coreGroups, displayRecordedDate, emptyDetails, legFields, profileGroups } from "./traveler";

export function travelerPrintHtml(record: CaseRecord) {
  const details = record.details || emptyDetails();
  const printedValue = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v) ? `<bdi dir="ltr">${e(v.slice(0,10))}</bdi>${e(v.slice(10))}` : e(v || "غير مدخل");
  const table = (rows: string[][]) => `<table>${rows.map(([label, value]) => `<tr><th>${e(label)}</th><td dir="auto">${printedValue(value)}</td></tr>`).join("")}</table>`;
  const core = coreGroups(record);
  const groups = profileGroups.map((g, i) => `<section><h2>${e(g.title)}</h2>${table([...core[i], ...g.fields.map(([k, label]) => [label, details.profile.values[k]]), ...g.dates.map(([k, label]) => [label, displayRecordedDate(details.profile.dates[k])])])}</section>`).join("");
  const movements = details.movements.map(m => `<section><h2>حركة السفر ${e(m.reference)}${m.id === details.latestEntryId ? " — آخر دخول حدده الموظف" : ""}</h2><p>المصدر: ${e(m.source)} • رقم التأشيرة: ${e(m.visaNumber || "غير مدخل")}</p>${(["entry", "exit"] as const).map(side => `<h3>${side === "entry" ? "الدخول" : "الخروج"}</h3>${table([["التاريخ", displayRecordedDate(m[side].date)], ["الوقت", m[side].time], ...legFields.map(([k, label]) => [label, m[side][k]]), ["النسخة المرتبطة", record.documents.find(d => d.id === m[side].documentId)?.filename || "لا توجد نسخة مرتبطة"]])}`).join("")}</section>`).join("");
  return `${groups}<p>مصدر الخانات الإضافية: ${e(details.profile.source || "غير مدخل")}. بيانات أدخلها الموظف، ولا يوجد ربط حكومي فعلي في هذا النموذج.</p><h2>سجل الدخول والخروج</h2>${movements || "<p>لم تُضف حركات تفصيلية. غياب السجل لا يثبت عدم السفر.</p>"}`;
}
