import { env } from "cloudflare:workers";
import { canonical, differences, signEvent } from "./integrated";
import type { User } from "./auth";

export class GovernanceError extends Error {constructor(public status:number,message:string){super(message);}}
export type JournalRow={id:number;owner:string;request_id:string;actor:string;actor_name:string;entity:string;entity_id:string;case_id:string|null;operation:string;reason:string;before_data:string|null;after_data:string|null;created_at:string;previous?:string;signature?:string};
const entities:Record<string,{id:string;data:string}>={
 cases:{id:"id",data:"json_set(data,'$.reference',reference)"},documents:{id:"id",data:"json_set(data,'$.fileSha256',sha256)"},
 case_details:{id:"case_id",data:"data"},intake_requests:{id:"id",data:"data"},directive_records:{id:"id",data:"data"},
 workflow_cases:{id:"case_id",data:"data"},operational_decisions:{id:"id",data:"data"},workspace_settings:{id:"owner",data:"data"},
 staff_users:{id:"id",data:"json_object('username',username,'displayName',display_name,'role',role,'active',active,'revision',revision)"},packet_reviews:{id:"id",data:"snapshot"},
};
export function database(){if(!env.DB)throw new GovernanceError(503,"قاعدة بيانات سَنَد غير متاحة.");return env.DB;}
function secret(){if(!env.SANAD_AUDIT_KEY||env.SANAD_AUDIT_KEY.length<32)throw new GovernanceError(503,"مفتاح حماية سجل التعديلات غير مجهز.");return env.SANAD_AUDIT_KEY;}
function payload(row:JournalRow){const {previous,signature,...rest}=row;return rest;}
async function journal(owner:string){return (await database().prepare("SELECT j.*,s.previous,s.signature FROM change_journal j LEFT JOIN journal_signatures s ON s.event_id=j.id WHERE j.owner=? ORDER BY j.id").bind(owner).all<JournalRow>()).results;}
export async function verifyIntegrity(owner:string,compareState=true){
 const rows=await journal(owner);let previous="GENESIS";let signed=0;const issues:string[]=[];const latest=new Map<string,JournalRow>();
 for(const row of rows){
  latest.set(`${row.entity}:${row.entity_id}`,row);
  if(!row.signature){issues.push(`unsigned:${row.id}`);continue;}
  if(row.previous!==previous||row.signature!==await signEvent(secret(),previous,payload(row)))issues.push(`signature:${row.id}`);
  previous=row.signature;signed++;
 }
 if(compareState)for(const [table,meta] of Object.entries(entities)){
  const actual=(await database().prepare(`SELECT ${meta.id} AS id,${meta.data} AS data FROM ${table} WHERE owner=?`).bind(owner).all<{id:string;data:string}>()).results;
  const found=new Set(actual.map(x=>x.id));
  for(const row of actual){const expected=latest.get(`${table}:${row.id}`);if(!expected||expected.after_data===null||canonical(JSON.parse(expected.after_data))!==canonical(JSON.parse(row.data)))issues.push(`state:${table}:${row.id}`);}
  for(const expected of latest.values())if(expected.entity===table&&expected.after_data!==null&&!found.has(expected.entity_id))issues.push(`missing:${table}:${expected.entity_id}`);
 }
 return {valid:issues.length===0,total:rows.length,signed,pending:rows.length-signed,head:previous,issues:issues.slice(0,20),checkedAt:new Date().toISOString(),scope:"توقيعات HMAC متسلسلة ومقارنة السجلات الحالية. حماية من تعديل قاعدة البيانات دون المفتاح؛ ليست ضمانًا ضد امتلاك الخادم والمفتاح معًا."};
}
export async function beginMutation(user:User,action:string,reason:string){
 const token=crypto.randomUUID();const now=Date.now();
 const lock=await database().prepare("INSERT INTO mutation_context(owner,token,actor,actor_name,reason,action,expires_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,actor=excluded.actor,actor_name=excluded.actor_name,reason=excluded.reason,action=excluded.action,expires_at=excluded.expires_at WHERE mutation_context.expires_at<=? RETURNING token").bind(user.owner,token,user.userId,user.displayName,reason,action,now+120000,now).first<{token:string}>();
 if(!lock)throw new GovernanceError(409,"تُحفظ عملية أخرى الآن. انتظر لحظة ثم أعد المحاولة؛ لم يتغير طلبك.");
 try{const report=await verifyIntegrity(user.owner);if(!report.valid)throw new GovernanceError(423,"تعذر التحقق من سلامة سجل التعديلات. أوقفت التغييرات لحين مراجعة المسؤول.");}catch(error){await release(user.owner,token);throw error;}
 return token;
}
async function release(owner:string,token:string){await database().prepare("DELETE FROM mutation_context WHERE owner=? AND token=?").bind(owner,token).run();}
export async function finishMutation(owner:string,token:string){
 const lock=await database().prepare("SELECT token FROM mutation_context WHERE owner=? AND token=? AND expires_at>?").bind(owner,token,Date.now()).first();
 if(!lock)throw new GovernanceError(503,"انتهت مهلة توثيق العملية. راجع الحالة قبل إعادة الحفظ.");
 const rows=await journal(owner);let previous="GENESIS";const statements:D1PreparedStatement[]=[];
 for(const row of rows){if(row.signature){previous=row.signature;continue;}
  if(row.request_id!==token)throw new GovernanceError(423,"يوجد تغيير لم يكتمل توثيقه؛ يلزم فحص المسؤول.");
  const signature=await signEvent(secret(),previous,payload(row));
  statements.push(database().prepare("INSERT INTO journal_signatures(event_id,owner,previous,signature) VALUES (?,?,?,?)").bind(row.id,owner,previous,signature));previous=signature;
 }
 // Business data and before/after are atomic. A crash before signing leaves a visible unsigned suffix and blocks later writes.
 statements.push(database().prepare("DELETE FROM mutation_context WHERE owner=? AND token=?").bind(owner,token));
 await database().batch(statements);
}
export async function securityEvent(owner:string,actor:string,kind:string,detail:string){await database().prepare("INSERT INTO security_events(id,owner,actor,kind,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),owner,actor,kind,detail.slice(0,300),new Date().toISOString()).run();}
export async function journalView(owner:string,caseId?:string){
 const rows=await journal(owner);return rows.filter(row=>!caseId||row.case_id===caseId).slice(-200).reverse().map(row=>({id:row.id,caseId:row.case_id,actor:row.actor_name,actorId:row.actor,entity:row.entity,entityId:row.entity_id,operation:row.operation,reason:row.reason,createdAt:row.created_at,signed:!!row.signature,signature:row.signature,changes:differences(row.before_data?JSON.parse(row.before_data):null,row.after_data?JSON.parse(row.after_data):null)}));
}
