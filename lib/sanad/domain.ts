import { CaseRecord, StoredDocument, FieldKey, Evidence, Answer } from "./types";
export function normalize(value: string): string { return value.normalize("NFKC").toUpperCase().replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/[\u064B-\u065F\u0670]/g,"").replace(/[\s<\-]+/g," ").trim(); }
export function caseStatus(documents: StoredDocument[]): CaseRecord["status"] {
  const passports = documents.filter(d => d.type === "passport");
  if (!passports.length) return "needs_document";
  return documents.every(d=>d.reviewStatus === "approved") ? "ready" : "needs_review";
}
export function discrepancies(record: CaseRecord, document: StoredDocument) {
  const values: Partial<Record<FieldKey,string>> = {name:record.englishName,passportNumber:record.passportNumber,nationality:record.nationality,birthDate:record.birthDate};
  if(document.type==="travel_document")delete values.passportNumber;
  return (Object.keys(values) as FieldKey[]).filter(key => values[key] && document.fields[key] && normalize(values[key]!) !== normalize(document.fields[key]));
}
export function evidenceFor(record: CaseRecord): Evidence[] {
  const evidence: Evidence[] = [
    {id:"record-reference",label:"مرجع الحالة",value:record.reference,source:"سجل الحالة"},
    {id:"record-entry",label:"تاريخ الدخول",value:record.entryDate,source:"سجل الدخول التجريبي"},
    {id:"record-border",label:"رقم الحدود",value:record.borderNumber,source:"سجل الدخول التجريبي"},
  ];
  for(const doc of record.documents) for(const [field, value] of Object.entries(doc.fields)) if(value) evidence.push({id:`${doc.id}:${field}`,documentId:doc.id,field:field as FieldKey,label:field,value,source:doc.source});
  return evidence;
}
export type Intent = "passport" | "differences" | "replacement" | "summary" | "nationality" | "source";
export const intentExamples: Record<Intent,string[]> = {
  passport:["أين صورة جواز السفر الأصلي؟ استرجع الوثيقة التي دخل بها", "هل نسخة الجواز محفوظة في الملف؟", "أحتاج مستند الدخول للمراجعة القنصلية"],
  differences:["ما الاختلاف بين بيانات الجواز وسجل الدخول؟", "هل هناك تعارض في الاسم أو رقم الوثيقة أو تاريخ الميلاد؟"],
  replacement:["هل نسخة وثيقة السفر البديلة محفوظة؟ بطاقة المرور", "صدرت وثيقة بديلة هل أرفقت بالملف؟"],
  summary:["جهز ملخص الملف والمستندات المتوفرة للمراجعة", "لخص الحالة وما الذي ينقص الملف؟"],
  nationality:["ما الجنسية المكتوبة في الجواز؟", "ما بلد الجنسية حسب الوثيقة؟"],
  source:["ما مصدر صورة الجواز ومتى حفظت؟", "أين قدمت الوثيقة ومن راجعها؟"]
};
export function directIntent(query: string): Intent | null {
  const q=normalize(query);
  if(/جنسي|دول|COUNTRY|NATIONALITY/.test(q))return "nationality";
  if(/اختلاف|اختلف|مختلف|فرق|فروق|تفاوت|تعارض|مطابق|DIFFER|CONFLICT/.test(q))return "differences";
  if(/بديل|مرور|REPLACEMENT/.test(q))return "replacement";
  if(/مصدر|متي|SOURCE/.test(q))return "source";
  if(/ملخص|لخص|جهز|ناقص|ينقص|SUMMARY/.test(q))return "summary";
  if(/جواز|وثيق|مستند|PASSPORT|DOCUMENT/.test(q))return "passport";
  return null;
}
export function answerFromRecord(record: CaseRecord, intent: Intent | null, mode: Answer["mode"]="direct"): Answer {
  const passport = record.documents.find(d=>d.type === "passport" && d.reviewStatus === "approved") || record.documents.find(d=>d.type === "passport");
  const all=evidenceFor(record); const docEvidence = passport ? all.filter(e=>e.documentId===passport.id):[]; const base={mode,evidence:docEvidence};
  if(!intent)return {mode,title:"لا توجد إجابة موثقة لهذا السؤال",text:"اسأل عن الوثائق المتاحة، مصادرها، اختلاف البيانات، أو الوثيقة البديلة. لا أستنتج معلومات غير موجودة في الملف.",evidence:[]};
  if(intent==="replacement"){
    const replacement=record.documents.find(d=>d.type==="travel_document");
    return {...base,title:replacement?"نسخة الوثيقة البديلة متاحة":"نسخة الوثيقة البديلة غير مرفقة",text:replacement?`رقم الوثيقة المسجل ${replacement.fields.passportNumber || "غير مدخل"}. مصدر النسخة: ${replacement.source}. حالة المراجعة: ${replacement.reviewStatus==="approved"?"راجعها الموظف":"لم تعتمد بعد"}.` : "لا توجد نسخة وثيقة بديلة ضمن المستندات التي أستطيع الوصول إليها في هذا الملف. هذا لا يثبت أنها لم تصدر خارج النظام.",evidence:replacement?all.filter(e=>e.documentId===replacement.id):[]};
  }
  if(!passport)return {...base,title:"نسخة الجواز غير متاحة",text:"السجل يحتوي بيانات دخول، لكن لم تُرفق صورة الجواز بهذا الملف. لا يمكن استعادة صورة لم تُحفظ. يلزم توفير نسخة من مصدر معتمد عند توفرها.",evidence:all.filter(e=>!e.documentId)};
  if(intent==="differences"){
    const keys=discrepancies(record,passport);
    return {...base,title:keys.length?`توجد ${keys.length} اختلافات تحتاج مراجعة` : "لم تظهر اختلافات في الحقول القابلة للمقارنة",text:keys.length?"اضغط على المراجع لمراجعة القيم الأصلية. قد يكون الاختلاف ناتجًا عن الإدخال أو القراءة؛ لا يُعد حكمًا على صحة الهوية أو أصالة المستند.":"تطابقت القيم المدخلة بعد توحيد المسافات وشكل الكتابة. هذا فحص اتساق بيانات، ولا يثبت صحة الوثيقة أو هوية حاملها.",evidence:docEvidence.filter(e=>keys.length?keys.includes(e.field!):true)};
  }
  if(intent==="nationality")return {...base,title:"الجنسية كما وردت في الوثيقة",text:`القيمة المدخلة من الجواز: ${passport.fields.nationality || "غير مقروءة"}. هذه قراءة للمستند، ولا تمثل قرارًا مستقلًا بشأن جنسية الشخص أو قبول القنصلية.`,evidence:docEvidence.filter(e=>e.field==="nationality")};
  if(intent==="source")return {...base,title:"مصدر النسخة وسجل مراجعتها",text:`المصدر المدخل: ${passport.source}. تاريخ تقديم المستند: ${passport.capturedAt}. ${passport.reviewStatus==="approved" ? "راجع الموظف الحقول وربط النسخة بالسجل." : "النسخة بانتظار مراجعة الموظف."} ${passport.synthetic?"المستند وبياناته تجريبيان بالكامل.":"المصدر وصف سجله المستخدم، وليس تصديقًا صادرًا من جهة حكومية."}`};
  if(intent==="summary")return {...base,title:"ملخص المستندات للمراجعة",text:`الحالة ${record.reference}. توجد ${record.documents.length} وثائق محفوظة، منها نسخة جواز ${passport.reviewStatus==="approved"?"تمت مراجعتها":"تحتاج مراجعة"}. ${discrepancies(record,passport).length?"توجد اختلافات بين الحقول المدخلة وسجل الدخول.":"لا تظهر اختلافات بين الحقول المتاحة للمقارنة."} يمكن تجهيز مسودة الملف من زر حزمة المراجعة. اعتماد المستندات وإصدار وثيقة السفر لدى الجهة المختصة.`};
  return {...base,title:"وجدت نسخة الجواز في الملف",text:`رقم الجواز المدخل: ${passport.fields.passportNumber || "غير مقروء"}. المصدر: ${passport.source}. ${passport.reviewStatus==="approved"?"تمت مراجعة النسخة من الموظف.":"النسخة لم تعتمد بعد، راجعها قبل استخدامها."} افتح أحد المراجع لمشاهدة المستند.`};
}
export function escapeHtml(value: string) { return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
