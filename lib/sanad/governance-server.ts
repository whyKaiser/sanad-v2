import { env } from "cloudflare:workers";
import { z } from "zod";
import type { User, StaffRow } from "./auth";
import type { CaseRecord } from "./types";
import { database, GovernanceError, journalView, securityEvent, verifyIntegrity } from "./integrity-server";
import { canonical, materialWorkflow, simulate, transitionIssue, userCreateSchema, userUpdateSchema, workflowSchema, type Workflow } from "./integrated";
import { hashPassword, randomToken, sha256 } from "./password";
import {reviewSignals} from './review-signals';

function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
async function body(request:Request){const text=await request.text();if(text.length>100000)throw new GovernanceError(413,"حجم الطلب غير مسموح.");return JSON.parse(text);}
export async function settings(owner:string){const row=await database().prepare("SELECT data,revision FROM workspace_settings WHERE owner=?").bind(owner).first<{data:string;revision:number}>();return {...(row?JSON.parse(row.data):{externalAi:false}),revision:row?.revision||0};}
export async function allowedAiEnv(owner:string){const config=await settings(owner);return {...env,GROQ_API_KEY:config.externalAi?env.GROQ_API_KEY:undefined};}
export async function authorize(user:User,request:Request){
 const path=new URL(request.url).pathname;const method=request.method;let denied=false;
 if(path.startsWith("/api/security")||path.startsWith("/api/users"))denied=user.role!=="admin";
 if(method!=="GET"&&user.role==="viewer"&&!['/api/assistant','/api/simulation'].includes(path))denied=true;
 if(method!=="GET"&&user.role==="officer"){
  if(/^\/api\/packet\/[^/]+$/.test(path)||/\/directives\/[^/]+\/prepare$/.test(path)||/\/intake\/[^/]+\/(review|dispatch)$/.test(path))denied=true;
  if(/^\/api\/documents\/[^/]+$/.test(path)&&method==="PATCH"){const input=await request.clone().json() as {reviewStatus?:string};if(input.reviewStatus==="approved")denied=true;}
  if(path==="/api/decisions")denied=true;
 }
 if(denied){await securityEvent(user.owner,user.userId,"permission_denied",`رفض صلاحية ${method} ${path.slice(0,160)}`);throw new GovernanceError(403,"حسابك لا يملك صلاحية هذا الإجراء. تواصل مع مشرف المراجعة.");}
}
export async function workflows(owner:string,records:CaseRecord[]){
 const rows=(await database().prepare("SELECT case_id,data,revision FROM workflow_cases WHERE owner=?").bind(owner).all<{case_id:string;data:string;revision:number}>()).results;
 return records.map(record=>{const row=rows.find(x=>x.case_id===record.id);return materialWorkflow(record,row?{...JSON.parse(row.data),revision:row.revision}:null);});
}
export async function governanceHandle(request:Request,user:User,getCase:(id:string)=>Promise<CaseRecord>,getRecords:()=>Promise<CaseRecord[]>):Promise<Response|null>{
 const db=database();const path=new URL(request.url).pathname.split('/').slice(2);const method=request.method;const owner=user.owner;
 if(path[0]==="me"&&method==="GET")return json(user);
 if(path[0]==="workflow"&&path[1]){
  const record=await getCase(path[1]);const current=(await workflows(owner,[record]))[0];
  if(method==="GET")return json(current);
  if(method==="PATCH"){
   const input=workflowSchema.parse(await body(request));if(input.revision!==current.revision)throw new GovernanceError(409,"تغيرت مرحلة المعاملة. حدّث الحالة قبل الحفظ.");
   const issue=transitionIssue(record,current,input.stage,user.role);if(issue)throw new GovernanceError(400,issue);
   if(input.assignee&&!await db.prepare("SELECT id FROM staff_users WHERE owner=? AND id=? AND active=1 AND role!='viewer'").bind(owner,input.assignee).first())throw new GovernanceError(400,"اختر موظفًا فعالًا من مساحة العمل.");
   const now=new Date().toISOString();const data:Omit<Workflow,'revision'>={...current,...input,caseId:record.id,enteredAt:input.stage===current.stage?current.enteredAt:now,updatedAt:now,approvedRevision:input.stage==="ready"||input.stage==="closed"?record.revision||1:null,needsReview:false};
   const result=current.revision===0?await db.prepare("INSERT INTO workflow_cases(case_id,owner,data,revision) VALUES (?,?,?,1) ON CONFLICT(case_id) DO NOTHING").bind(record.id,owner,JSON.stringify(data)).run():await db.prepare("UPDATE workflow_cases SET data=?,revision=revision+1 WHERE case_id=? AND owner=? AND revision=?").bind(JSON.stringify(data),record.id,owner,input.revision).run();
   if(!result.meta.changes)throw new GovernanceError(409,"تغيرت المعاملة أثناء الحفظ؛ حدّث الصفحة.");
   return json((await workflows(owner,[record]))[0]);
  }
 }
 if(path[0]==="team"&&method==="GET")return json((await db.prepare("SELECT id,display_name AS displayName,role FROM staff_users WHERE owner=? AND active=1 ORDER BY display_name").bind(owner).all()).results);
 if(path[0]==="journal"&&method==="GET"){
  if(path[1])await getCase(path[1]);return json({events:await journalView(owner,path[1]),integrity:await verifyIntegrity(owner)});
 }
 if(path[0]==="operations"&&method==="GET"){
  const records=await getRecords();const list=await workflows(owner,records);
  const decisions=(await db.prepare("SELECT id,data,created_at AS createdAt FROM operational_decisions WHERE owner=? ORDER BY created_at DESC LIMIT 50").bind(owner).all<{id:string;data:string;createdAt:string}>()).results.map(r=>({id:r.id,...JSON.parse(r.data),createdAt:r.createdAt}));
  return json({workflows:list,records:records.map(c=>({id:c.id,name:c.name,reference:c.reference})),decisions,computedAt:new Date().toISOString()});
 }
 if(path[0]==="signals"&&method==="GET")return json({signals:reviewSignals(await getRecords(),await journalView(owner)),scope:'مقارنات وثائق وقواعد تشغيلية قابلة للتفسير. لا تقييم أمني للأشخاص ولا إيقاف آلي للحسابات. مراقبة التعديلات مبنية على آخر 200 حدث.'});
 if(path[0]==="simulation"&&method==="POST")return json(simulate(await workflows(owner,await getRecords()),await body(request)));
 if(path[0]==="decisions"&&method==="POST"){
  const input=z.object({inputs:z.unknown(),decision:z.enum(["approved","rejected"]),reason:z.string().trim().min(8).max(500)}).strict().parse(await body(request));
  const list=await workflows(owner,await getRecords());const simulation=simulate(list,input.inputs);
  const id=crypto.randomUUID();const now=new Date().toISOString();const data={...input,simulation,actor:user.displayName,actorId:user.userId,basis:await sha256(canonical(list)),scope:"قرار موثق على خطة تجريبية. لا ينفذ إعادة توزيع موظفين أو أي إجراء حكومي."};
  await db.prepare("INSERT INTO operational_decisions(id,owner,data,created_at) VALUES (?,?,?,?)").bind(id,owner,JSON.stringify(data),now).run();return json({id,...data,createdAt:now},201);
 }
 if(path[0]==="security"&&method==="GET"){
  return json({settings:await settings(owner),integrity:await verifyIntegrity(owner),events:(await db.prepare("SELECT id,actor,kind,detail,created_at AS createdAt FROM security_events WHERE owner=? ORDER BY created_at DESC LIMIT 100").bind(owner).all()).results,sessions:(await db.prepare("SELECT username,COUNT(*) AS count FROM auth_sessions WHERE owner=? AND expires_at>? GROUP BY username").bind(owner,Date.now()).all()).results});
 }
 if(path[0]==="security"&&path[1]==="settings"&&method==="PATCH"){
  const input=z.object({externalAi:z.boolean(),revision:z.number().int().nonnegative()}).strict().parse(await body(request));const current=await settings(owner);
  if(input.revision!==current.revision)throw new GovernanceError(409,"تغيرت إعدادات الحماية؛ حدّث الشاشة.");
  if(input.externalAi&&!env.GROQ_API_KEY)throw new GovernanceError(400,"أضف مفتاح Groq في أسرار الخادم قبل التفعيل.");
  const data=JSON.stringify({externalAi:input.externalAi});const result=current.revision===0?await db.prepare("INSERT INTO workspace_settings(owner,data,revision) VALUES (?,?,1) ON CONFLICT(owner) DO NOTHING").bind(owner,data).run():await db.prepare("UPDATE workspace_settings SET data=?,revision=revision+1 WHERE owner=? AND revision=?").bind(data,owner,input.revision).run();
  if(!result.meta.changes)throw new GovernanceError(409,"تغيرت الإعدادات أثناء الحفظ.");return json(await settings(owner));
 }
 if(path[0]==="users"&&method==="GET")return json((await db.prepare("SELECT id,username,display_name AS displayName,role,active,revision,created_at AS createdAt FROM staff_users WHERE owner=? ORDER BY created_at").bind(owner).all()).results);
 if(path[0]==="users"&&!path[1]&&method==="POST"){
  const input=userCreateSchema.parse(await body(request));
  if(await db.prepare("SELECT id FROM staff_users WHERE username=?").bind(input.username).first())throw new GovernanceError(409,"اسم المستخدم غير متاح.");
  const count=await db.prepare("SELECT COUNT(*) AS count FROM staff_users WHERE owner=?").bind(owner).first<{count:number}>();if((count?.count||0)>=25)throw new GovernanceError(400,"حد النسخة التجريبية 25 حسابًا.");
  const id=crypto.randomUUID();await db.prepare("INSERT INTO staff_users(id,owner,username,display_name,password_hash,role,auth_version,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,owner,input.username,input.displayName,await hashPassword(input.password),input.role,randomToken(),new Date().toISOString()).run();return json({id},201);
 }
 if(path[0]==="users"&&path[1]&&method==="PATCH"){
  const input=userUpdateSchema.parse(await body(request));const row=await db.prepare("SELECT * FROM staff_users WHERE id=? AND owner=?").bind(path[1],owner).first<StaffRow>();if(!row)throw new GovernanceError(404,"الحساب غير متاح.");
  if(row.id===user.userId&&(!input.active||input.role!=="admin"))throw new GovernanceError(400,"لا يمكنك تعطيل حسابك الإداري أو خفض صلاحيته بنفسك.");
  const result=await db.prepare("UPDATE staff_users SET role=?,active=?,revision=revision+1,auth_version=? WHERE id=? AND owner=? AND revision=?").bind(input.role,input.active?1:0,(input.revoke||input.role!==row.role||!input.active)?randomToken():row.auth_version,row.id,owner,input.revision).run();
  if(!result.meta.changes)throw new GovernanceError(409,"تغير الحساب أثناء التعديل؛ حدّث الشاشة.");return json({ok:true});
 }
 return null;
}
