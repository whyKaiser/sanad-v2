import type { ZodIssue } from "zod";
import { legFields, profileGroups } from "./traveler";
const labels: Record<string, string> = { revision: "نسخة السجل", reference: "رقم سجل السفر", visaNumber: "رقم التأشيرة", source: "المصدر", time: "الوقت", date: "التاريخ", documentId: "النسخة المرتبطة", name: "الاسم", englishName: "الاسم بالإنجليزية", borderNumber: "رقم الحدود", passportNumber: "رقم الوثيقة", nationality: "الجنسية حسب السجل", birthDate: "تاريخ الميلاد", entryDate: "تاريخ الدخول", expiryDate: "تاريخ الانتهاء", notes: "الملاحظات", query: "السؤال", ...Object.fromEntries(legFields), ...Object.fromEntries(profileGroups.flatMap((g): (readonly [string, string])[] => [...g.fields, ...g.dates])) };
export function validationMessage(issue: ZodIssue) {
  const path = issue.path.filter(p => !["value", "calendar"].includes(String(p)));
  const label = labels[String(path.at(-1))] || "البيانات";
  const side = path.includes("entry") ? " — الدخول" : path.includes("exit") ? " — الخروج" : "";
  let message = issue.message;
  if (issue.code === "too_big") message = `تجاوز الحد المسموح (${issue.maximum})`;
  else if (issue.code === "too_small") message = "الحقل ناقص أو أقصر من المطلوب";
  else if (issue.code === "unrecognized_keys") message = "الطلب يحتوي خانات غير معروفة";
  else if (!/[\u0600-\u06FF]/.test(message)) message = "القيمة غير صحيحة أو غير مكتملة";
  return `${label}${side}: ${message}`;
}

