import { z } from "zod";
const short = z.string().trim().max(160);
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v);return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},"التاريخ غير صحيح");
export const fieldsSchema=z.object({name:short,passportNumber:short.max(40),nationality:short,birthDate:z.union([dateString,z.literal("")]),expiryDate:z.union([dateString,z.literal("")])}).strict();
export const newCaseSchema=z.object({name:short.min(2),englishName:short.min(2),borderNumber:short.min(3).max(40),visaNumber:short.min(3).max(40),passportNumber:short.min(3).max(40),nationality:short.min(2),birthDate:dateString,entryDate:dateString,visaType:short.min(1),port:short.min(1),notes:z.string().trim().max(2000).default(""),synthetic:z.literal(true)}).strict().refine(v=>v.birthDate<v.entryDate,"تاريخ الميلاد يجب أن يسبق تاريخ الدخول");
export const reviewSchema=z.object({fields:fieldsSchema,reviewStatus:z.enum(["approved","needs_correction","pending"]),reviewNote:z.string().trim().max(2000),revision:z.number().int().positive()}).strict().refine(v=>v.reviewStatus!=="approved" || Object.values(v.fields).every(Boolean),"أكمل الحقول قبل اعتماد المراجعة");
export const caseUpdateSchema=z.object({notes:z.string().trim().max(2000),consularStatus:z.enum(["not_started","under_review","document_issued","additional_info"])}).strict();
export const assistantSchema=z.object({caseId:z.string().min(1).max(80),query:z.string().trim().min(2).max(700),intent:z.enum(["passport","differences","replacement","summary","nationality","source"]).nullable().optional(),semantic:z.boolean().optional()}).strict();
export const locationSchema=z.record(z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(0).max(1),height:z.number().min(0).max(1)})).refine(v=>Object.keys(v).every(k=>["name","passportNumber","nationality","birthDate","expiryDate"].includes(k)),"موضع الحقل غير صالح");
export function detectedMime(bytes:Uint8Array):string|null {
  if(bytes.length>=8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return "image/png";
  if(bytes.length>=3 && bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
  if(bytes.length>=5 && new TextDecoder().decode(bytes.slice(0,5))==="%PDF-")return "application/pdf";
  return null;
}
