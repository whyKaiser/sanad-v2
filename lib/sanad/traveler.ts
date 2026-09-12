import { z } from "zod";
import type { Answer, CaseRecord, Evidence } from "./types";

export type Calendar = "gregorian" | "hijri";
export type RecordedDate = { value: string; calendar: Calendar };
export const calendarLabels = { gregorian: "ميلادي", hijri: "هجري" };
export function validRecordedDate(value: string, calendar: Calendar) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (calendar === "hijri") return year >= 1200 && year <= 1800 && month >= 1 && month <= 12 && day >= 1 && day <= 30;
  const date = new Date(value);
  return year >= 1800 && year <= 2200 && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const recordedDateSchema = z.object({ value: z.string().max(10), calendar: z.enum(["gregorian", "hijri"]) }).strict()
  .refine(v => validRecordedDate(v.value, v.calendar), "أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD وفق التقويم المختار");
export const emptyDate = (): RecordedDate => ({ value: "", calendar: "gregorian" });
export function displayRecordedDate(date?: RecordedDate) { return date?.value ? `${date.value} — ${calendarLabels[date.calendar]}` : "غير مدخل"; }

export const profileGroups = [
  { title: "معلومات الزائر", fields: [
    ["identityNumber", "رقم الهوية"], ["visitorType", "نوع الزائر"], ["gender", "الجنس"],
    ["recordStatus", "الحالة في السجل"], ["religion", "الديانة"], ["description", "الوصف"], ["travelRecordNumber", "سجل السفر"],
  ], dates: [["statusDate", "تاريخ الحالة"]] },
  { title: "الجواز المسجل", fields: [["documentType", "نوع الوثيقة"], ["passportType", "نوع الجواز"], ["passportIssuePlace", "مكان إصدار الجواز"]], dates: [["passportIssueDate", "تاريخ إصدار الجواز"], ["passportExpiryDate", "تاريخ انتهاء الجواز"]] },
  { title: "التأشيرة", fields: [["visaTrips", "عدد السفرات"], ["visaIssuePlace", "مكان إصدار التأشيرة"], ["visaDays", "التأشيرة بالأيام"], ["stayDays", "مدة الإقامة بالأيام"], ["remainingDays", "المدة المتبقية حسب السجل"]], dates: [["visaIssueDate", "تاريخ إصدار التأشيرة"], ["visaExpiryDate", "تاريخ انتهاء التأشيرة"], ["remainingAsOf", "تاريخ رصد المدة المتبقية"]] },
  { title: "تفاصيل التأشيرة والمتابعة", fields: [["interiorOrderNumber", "رقم أمر الداخلية"], ["amount", "المبلغ"], ["receiptNumber", "رقم الإيصال"], ["fineReceiptNumber", "رقم إيصال الغرامة"], ["fineAmount", "مبلغ الغرامة"], ["employerNumber", "رقم صاحب العمل"], ["employerName", "اسم صاحب العمل"], ["address", "العنوان"]], dates: [["finalDepartureDate", "المغادرة النهائية حسب السجل"]] },
] as const;
export const profileFieldKeys = profileGroups.flatMap(g => g.fields.map(f => f[0]));
export const profileDateKeys = profileGroups.flatMap(g => g.dates.map(f => f[0]));
export type ProfileField = typeof profileFieldKeys[number];
export type ProfileDate = typeof profileDateKeys[number];
export type TravelerProfile = { values: Record<ProfileField, string>; dates: Record<ProfileDate, RecordedDate>; source: string };
export function emptyProfile(): TravelerProfile {
  return { values: Object.fromEntries(profileFieldKeys.map(k => [k, ""])) as TravelerProfile["values"], dates: Object.fromEntries(profileDateKeys.map(k => [k, emptyDate()])) as TravelerProfile["dates"], source: "" };
}
const text = z.string().trim().max(160);
const profileValueShape = Object.fromEntries(profileFieldKeys.map(k => [k, z.string().trim().max(k === "address" ? 500 : 160)])) as Record<ProfileField, z.ZodString>;
export const profileSchema = z.object({ values: z.object(profileValueShape).strict(), dates: z.object(Object.fromEntries(profileDateKeys.map(k => [k, recordedDateSchema])) as Record<ProfileDate, typeof recordedDateSchema>).strict(), source: text.min(2, "اكتب مصدر البيانات") }).strict().superRefine((p, ctx) => {
  for (const k of ["visaDays", "stayDays", "remainingDays"] as const) {
    if (p.values[k] && !/^-?\d{1,6}$/.test(p.values[k])) ctx.addIssue({ code: "custom", path: ["values", k], message: "أدخل عدد أيام صحيحًا" });
    if (k !== "remainingDays" && p.values[k].startsWith("-")) ctx.addIssue({ code: "custom", path: ["values", k], message: "المدة لا تكون سالبة" });
  }
  if (p.values.remainingDays && !p.dates.remainingAsOf.value) ctx.addIssue({ code: "custom", path: ["dates", "remainingAsOf"], message: "حدد تاريخ رصد المدة المتبقية؛ لا تُحسب تلقائيًا" });
  for (const [start, end] of [["passportIssueDate", "passportExpiryDate"], ["visaIssueDate", "visaExpiryDate"]] as const) {
    const a = p.dates[start], b = p.dates[end];
    if (a.value && b.value && a.calendar === b.calendar && a.value > b.value) ctx.addIssue({ code: "custom", path: ["dates", end], message: "الانتهاء يجب ألا يسبق الإصدار" });
  }
});

export const legFields = [["documentNumber", "رقم الوثيقة في الحركة"], ["transport", "الوسيلة"], ["direction", "الجهة"], ["carrier", "الناقلة / الرحلة"], ["location", "الموقع / المنفذ"], ["operatorNumber", "رقم المشغّل"]] as const;
export type LegField = typeof legFields[number][0];
export type TravelLeg = Record<LegField, string> & { date: RecordedDate; time: string; documentId: string };
export type TravelMovement = { id: string; reference: string; visaNumber: string; source: string; entry: TravelLeg; exit: TravelLeg; createdAt: string; updatedAt: string };
export function emptyLeg(): TravelLeg { return { ...Object.fromEntries(legFields.map(([k]) => [k, ""])), date: emptyDate(), time: "", documentId: "" } as TravelLeg; }
export const legSchema = z.object({ ...Object.fromEntries(legFields.map(([k]) => [k, text])) as Record<LegField, z.ZodString>, date: recordedDateSchema, time: z.string().regex(/^(?:|(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)$/, "وقت غير صحيح"), documentId: z.string().max(80) }).strict().superRefine((leg, ctx) => {
  if (!leg.date.value && (leg.time || leg.documentId || legFields.some(([k]) => leg[k]))) ctx.addIssue({ code: "custom", path: ["date"], message: "أدخل تاريخ الحركة عند تسجيل تفاصيلها" });
});
export const movementSchema = z.object({ reference: text.min(2).max(80), visaNumber: text.max(40), source: text.min(2), entry: legSchema, exit: legSchema }).strict().superRefine((m, ctx) => {
  if (!m.entry.date.value) ctx.addIssue({ code: "custom", path: ["entry", "date"], message: "تاريخ الدخول مطلوب" });
  const fullTime = (v: string) => v.length === 5 ? `${v}:00` : v;
  if (m.exit.date.value && m.entry.date.calendar === m.exit.date.calendar && (m.exit.date.value < m.entry.date.value || (m.exit.date.value === m.entry.date.value && m.entry.time && m.exit.time && fullTime(m.exit.time) < fullTime(m.entry.time)))) ctx.addIssue({ code: "custom", path: ["exit", "date"], message: "الخروج يجب ألا يسبق الدخول في الحركة نفسها" });
});
export const profileUpdateSchema = z.object({ revision: z.number().int().min(0), profile: profileSchema }).strict();
export const movementUpdateSchema = z.object({ revision: z.number().int().min(0), movement: movementSchema, setLatestEntry: z.boolean() }).strict();
export type CaseDetails = { revision: number; profile: TravelerProfile; movements: TravelMovement[]; latestEntryId: string | null };
export function emptyDetails(): CaseDetails { return { revision: 0, profile: emptyProfile(), movements: [], latestEntryId: null }; }
export function coreGroups(record: CaseRecord) {
  return [
    [["الاسم بالعربية", record.name], ["الاسم بالإنجليزية", record.englishName], ["رقم الحدود", record.borderNumber], ["تاريخ الميلاد — ميلادي", record.birthDate]],
    [["رقم الجواز", record.passportNumber], ["الجنسية حسب السجل", record.nationality]],
    [["رقم التأشيرة", record.visaNumber], ["نوع التأشيرة", record.visaType]],
    [],
  ];
}

// These exact-record answers stay local. Personal characteristics are never inputs to an AI decision.
export function answerTravelerQuery(record: CaseRecord, query: string): Answer | null {
  const q = query.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
  if (/رحل|يرحل|ترحيل|ابعاد|امنع|ممنوع|مخالف|جنسي|اثبت|تزوير|مزور|خطر/.test(q)) return null;
  if (/جواز|وثيق|مستند|اختلاف|تعارض|مصدر/.test(q)) return null;
  const details = record.details || emptyDetails();
  if (/تاشير|اقامه|اقامة|متبقي|مده|مدة/.test(q)) {
    const p = details.profile;
    const evidence: Evidence[] = [{ id: "visa-number", label: "رقم التأشيرة", value: record.visaNumber, source: "سجل الحالة", section: "record" }, { id: "visa-type", label: "نوع التأشيرة", value: record.visaType, source: "سجل الحالة", section: "record" }];
    for (const [key, label] of profileGroups[2].fields) if (p.values[key]) evidence.push({ id: `visa-${key}`, label, value: p.values[key], source: p.source, section: "record" });
    for (const [key, label] of profileGroups[2].dates) if (p.dates[key].value) evidence.push({ id: `visa-${key}`, label, value: displayRecordedDate(p.dates[key]), source: p.source, section: "record" });
    return { title: "بيانات التأشيرة المحفوظة", text: evidence.map(e => `${e.label}: ${e.value}`).join(". ") + ". المدة المتبقية قيمة أدخلها الموظف بتاريخ رصدها؛ لا تمثل حسابًا آنيًا أو حكمًا على وضع الإقامة.", evidence, mode: "direct" };
  }
  if (/حرك|سجل السفر|دخول|خروج|غادر/.test(q)) {
    const m = details.movements.find(m => m.id === details.latestEntryId);
    if (!m) return { title: "آخر دخول لم يُحدد من الحركات", text: `توجد ${details.movements.length} حركات محفوظة. تاريخ الدخول الأساسي ${record.entryDate} — ميلادي، والمنفذ ${record.port}. يحدد الموظف آخر دخول من سجل الحركات. غياب حركة خروج لا يثبت بقاء الشخص.`, mode: "direct", evidence: [{ id: "travel-base", label: "تاريخ الدخول الأساسي — ميلادي", value: record.entryDate, source: "سجل الحالة", section: "travel" }] };
    const evidence: Evidence[] = [ { id: `movement-${m.id}`, label: "رقم سجل السفر", value: m.reference, source: m.source, section: "travel", movementId: m.id }, { id: `entry-${m.id}`, label: "تاريخ الدخول", value: displayRecordedDate(m.entry.date), source: m.source, section: "travel", movementId: m.id } ];
    if (m.exit.date.value) evidence.push({ id: `exit-${m.id}`, label: "تاريخ الخروج", value: displayRecordedDate(m.exit.date), source: m.source, section: "travel", movementId: m.id });
    return { title: "آخر دخول المحدد في السجل", text: `حدد الموظف الحركة ${m.reference} كآخر دخول. ${evidence.slice(1).map(e => `${e.label}: ${e.value}`).join(". ")}. ${m.exit.date.value ? "الخروج مسجل في هذه الحركة فقط؛ لا يُستنتج منه الوضع الحالي خارج السجلات المتاحة." : "لا توجد بيانات خروج في هذه الحركة؛ هذا لا يثبت أن الشخص لم يغادر."}`, evidence, mode: "direct" };
  }
  return null;
}
