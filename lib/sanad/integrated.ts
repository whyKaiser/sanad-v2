import { z } from "zod";
import type { CaseRecord } from "./types";

export const roles = ["admin", "reviewer", "officer", "viewer"] as const;
export type Role = typeof roles[number];
export const roleLabels: Record<Role, string> = {admin:"مسؤول النظام",reviewer:"مشرف المراجعة",officer:"موظف المعالجة",viewer:"عرض فقط"};
export const stages = ["intake", "review", "external_wait", "ready", "closed"] as const;
export type Stage = typeof stages[number];
export const stageLabels: Record<Stage,string> = {intake:"استكمال الوثائق",review:"مراجعة الموظف",external_wait:"انتظار جهة خارجية",ready:"جاهز لاستكمال الإجراء",closed:"أُغلقت المتابعة"};
export const workflowSchema = z.object({revision:z.number().int().nonnegative(),stage:z.enum(stages),reason:z.string().trim().min(8).max(500),assignee:z.string().max(80),expectedDays:z.number().int().min(1).max(90)}).strict();
export type Workflow = {caseId:string;revision:number;stage:Stage;reason:string;assignee:string;expectedDays:number;enteredAt:string;updatedAt:string;approvedRevision:number|null;needsReview:boolean;elapsedDays:number};
export type Change = {field:string;before:unknown;after:unknown};
export function canonical(value:unknown):string {
  if(value===undefined)return "null";
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,val])=>`${JSON.stringify(key)}:${canonical(val)}`).join(",")}}`;
}
export function differences(before:unknown,after:unknown,path=""):Change[]{
  if(canonical(before)===canonical(after))return [];
  if(before&&after&&typeof before==="object"&&typeof after==="object"&&!Array.isArray(before)&&!Array.isArray(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(key=>differences((before as Record<string,unknown>)[key],(after as Record<string,unknown>)[key],path?`${path}.${key}`:key));
  return [{field:path||"record",before:before??null,after:after??null}];
}
export async function signEvent(secret:string,previous:string,payload:unknown){
  const encoder=new TextEncoder();const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(`${previous}\n${canonical(payload)}`)))].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export function defaultWorkflow(record:CaseRecord,now=Date.now()):Workflow{
  return {caseId:record.id,revision:0,stage:record.documents.some(d=>d.type==="passport")?"review":"intake",reason:"بدأت المتابعة من حالة الوثائق الحالية",assignee:"",expectedDays:3,enteredAt:record.createdAt,updatedAt:record.createdAt,approvedRevision:null,needsReview:false,elapsedDays:Math.max(0,(now-Date.parse(record.createdAt))/86400000)};
}
export function materialWorkflow(record:CaseRecord,stored:Partial<Workflow>|null,now=Date.now()):Workflow{
  const w={...defaultWorkflow(record,now),...stored};
  w.needsReview=(w.stage==="ready"||w.stage==="closed")&&w.approvedRevision!==record.revision;
  w.elapsedDays=Math.max(0,(now-Date.parse(w.enteredAt))/86400000);return w;
}
export function transitionIssue(record:CaseRecord,current:Workflow,next:Stage,role:Role):string|null{
  if(role==="viewer")return "حساب العرض لا يغيّر المعاملات.";
  if((next==="ready"||next==="closed")&&role!=="reviewer"&&role!=="admin")return "اعتماد الجاهزية والإغلاق من صلاحية مشرف المراجعة.";
  if(next==="ready"&&record.status!=="ready")return "أكمل مراجعة الوثائق قبل اعتماد جاهزية المعاملة.";
  if(next==="closed"&&(current.stage!=="ready"||current.needsReview))return "اعتمد جاهزية النسخة الحالية قبل إغلاق المتابعة.";
  if(current.stage==="closed"&&next!=="review"&&next!=="closed")return "أعد فتح المعاملة للمراجعة أولًا.";
  return null;
}
export const simulationSchema=z.object({reviewers:z.number().int().min(1).max(50),additional:z.number().int().min(0).max(50),minutesPerCase:z.number().min(5).max(240),productiveHours:z.number().min(1).max(12),arrivalsPerDay:z.number().min(0).max(1000),horizonDays:z.number().int().min(1).max(30)}).strict();
export function simulate(workflows:Workflow[],raw:unknown){
  const input=simulationSchema.parse(raw);
  const internal=workflows.filter(w=>w.stage==="review"||w.needsReview).length;
  const external=workflows.filter(w=>w.stage==="external_wait").length;
  const missing=workflows.filter(w=>w.stage==="intake").length;
  const forecast=(count:number)=>{
    const capacity=count*input.productiveHours*60/input.minutesPerCase;
    const net=capacity-input.arrivalsPerDay;
    const points=Array.from({length:input.horizonDays+1},(_,day)=>({day,backlog:Math.round(Math.max(0,internal-net*day)*10)/10}));
    return {capacityPerDay:Math.round(capacity*10)/10,clearanceDays:internal===0?0:net>0?Math.ceil(internal/net):null,points};
  };
  return {input,internal,external,missing,baseline:forecast(input.reviewers),proposed:forecast(input.reviewers+input.additional),kind:"capacity_simulation" as const,assumption:"محاكاة حسابية بافتراض وصول منتظم ومتوسط معالجة ثابت؛ ليست توقعًا مدربًا على بيانات حكومية.",recommendation:input.additional>0?"راجع توزيع موظفي المراجعة وفق السعة المعروضة. الانتظار الخارجي ونقص الوثائق يحتاجان إجراءً مستقلًا.":"جرّب إضافة مراجع للمقارنة، ثم اعتمد أي تغيير تشغيلي بشريًا."};
}
export const userCreateSchema=z.object({username:z.string().trim().regex(/^[a-z0-9_.-]{3,40}$/),displayName:z.string().trim().min(2).max(80),role:z.enum(roles),password:z.string().min(8).max(200)}).strict();
export const userUpdateSchema=z.object({role:z.enum(roles),active:z.boolean(),revoke:z.boolean(),revision:z.number().int().positive(),password:z.string().min(8).max(200).optional()}).strict();
