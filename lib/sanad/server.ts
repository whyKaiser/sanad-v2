import { env } from "cloudflare:workers";
import { getCurrentUser, handleAuth } from "./auth";
import { documentStore } from "./storage";
import { ZodError } from "zod";
import { CaseRecord, StoredDocument, AuditEvent, TravelFields } from "./types";
import { caseStatus, answerFromRecord, directIntent, discrepancies, escapeHtml } from "./domain";
import { assistantSchema, caseUpdateSchema, detectedMime, fieldsSchema, newCaseSchema, reviewSchema, dateString, locationSchema } from "./validation";
import { demoCases, demoRecord, syntheticLocations, syntheticSvg } from "./demo";
import { answerWithGroq, groqConfiguration } from "./groq";

class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
function db(){if(!env.DB)throw new HttpError(503,"قاعدة البيانات غير متاحة. حاول مجددًا بعد قليل.");return env.DB;}
function bucket(){return documentStore(db());}
export const securityHeaders={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin"};
function json(value:unknown,status=200){return Response.json(value,{status,headers:securityHeaders});}
function audit(owner:string,caseId:string|null,action:string,detail:string){return db().prepare("INSERT INTO audit_log (id,owner,case_id,action,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),owner,caseId,action,detail,new Date().toISOString());}
type CaseRow={id:string;owner:string;reference:string;data:string;created_at:string;updated_at:string};
type DocRow={id:string;owner:string;case_id:string;object_key:string;sha256:string;data:string;revision:number;created_at:string};
function unpackDoc(row:DocRow):StoredDocument{return {...JSON.parse(row.data),id:row.id,caseId:row.case_id,sha256:row.sha256,createdAt:row.created_at,revision:row.revision};}
async function documentRow(owner:string,id:string){const row=await db().prepare("SELECT * FROM documents WHERE owner=? AND id=?").bind(owner,id).first<DocRow>();if(!row)throw new HttpError(404,"المستند غير موجود أو غير متاح لحسابك.");return row;}
async function getCase(owner:string,id:string):Promise<CaseRecord>{
  const row=await db().prepare("SELECT * FROM cases WHERE owner=? AND id=?").bind(owner,id).first<CaseRow>();
  if(!row)throw new HttpError(404,"الحالة غير موجودة أو غير متاحة لحسابك.");
  const docs=await db().prepare("SELECT * FROM documents WHERE owner=? AND case_id=? ORDER BY created_at DESC").bind(owner,id).all<DocRow>();
  const documents=docs.results.map(unpackDoc);
  return {...JSON.parse(row.data),id:row.id,reference:row.reference,createdAt:row.created_at,updatedAt:row.updated_at,documents,status:caseStatus(documents)};
}
async function state(owner:string){
  const [rows,docs,events]=await Promise.all([
    db().prepare("SELECT * FROM cases WHERE owner=? ORDER BY updated_at DESC").bind(owner).all<CaseRow>(),
    db().prepare("SELECT * FROM documents WHERE owner=? ORDER BY created_at DESC").bind(owner).all<DocRow>(),
    db().prepare("SELECT id,case_id AS caseId,action,detail,created_at AS createdAt FROM audit_log WHERE owner=? ORDER BY created_at DESC LIMIT 150").bind(owner).all<AuditEvent>(),
  ]);
  return {cases:rows.results.map(row=>{const documents=docs.results.filter(d=>d.case_id===row.id).map(unpackDoc);return {...JSON.parse(row.data),id:row.id,reference:row.reference,createdAt:row.created_at,updatedAt:row.updated_at,documents,status:caseStatus(documents)};}),audit:events.results,ai:groqConfiguration(env),demoOnly:true};
}
async function body(request:Request){const raw=await request.text();if(raw.length>100_000)throw new HttpError(413,"الطلب أكبر من الحد المسموح.");try{return JSON.parse(raw);}catch{throw new HttpError(400,"صيغة الطلب غير صحيحة.");}}
async function hash(data:ArrayBuffer|Uint8Array){const h=await crypto.subtle.digest("SHA-256",data as BufferSource);return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,"0")).join("");}
async function seed(owner:string){
  const count=await db().prepare("SELECT COUNT(*) AS count FROM cases WHERE owner=?").bind(owner).first<{count:number}>();
  if(count?.count)throw new HttpError(409,"مساحة العمل تحتوي حالات بالفعل. لن نستبدل بياناتك.");
  const statements:D1PreparedStatement[]=[];const keys:string[]=[];const now=new Date().toISOString();
  try{
    for(let i=0;i<demoCases.length;i++){
      const id=crypto.randomUUID();const r=demoRecord(i);const ref=`SND-2026-${String(i+1).padStart(4,"0")}`;
      statements.push(db().prepare("INSERT INTO cases (id,owner,reference,data,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id,owner,ref,JSON.stringify(r),now,now));
      if(demoCases[i].status!=="needs_document"){
        for(let n=0;n<(i===3?2:1);n++){
          const docId=crypto.randomUUID();const type=n===0?"passport":"travel_document";
          const fields:TravelFields={name:i===2?"YUSUF RAHIM":r.englishName,passportNumber:n===0?r.passportNumber:`SND-TD-100${i}`,nationality:r.nationality,birthDate:r.birthDate,expiryDate:"2030-04-12"};
          const svg=syntheticSvg(fields,type);const bytes=new TextEncoder().encode(svg);const sha=await hash(bytes);const key=`${owner}/${id}/${docId}`;
          await bucket().put(key,bytes,{httpMetadata:{contentType:"image/svg+xml"}});keys.push(key);
          const document={type,filename:`${type}-specimen-${i+1}.svg`,contentType:"image/svg+xml",size:bytes.length,source:n===0?"قناة التأشيرة — محاكاة":"وثيقة بديلة — محاكاة",capturedAt:r.entryDate,fields,extractedText:Object.values(fields).join("\n"),confidence:null,locations:syntheticLocations,reviewStatus:demoCases[i].status==="ready"?"approved":"pending",reviewNote:demoCases[i].status==="ready"?"مراجعة تجريبية للبيانات الاصطناعية":"",reviewedAt:demoCases[i].status==="ready"?now:null,synthetic:true,extractionMethod:"synthetic"};
          statements.push(db().prepare("INSERT INTO documents (id,owner,case_id,object_key,sha256,data,revision,created_at) VALUES (?,?,?,?,?,?,1,?)").bind(docId,owner,id,key,sha,JSON.stringify(document),now));
        }
      }
      statements.push(audit(owner,id,"demo_created",`إنشاء الحالة التجريبية ${ref}`));
    }
    await db().batch(statements);
  }catch(error){await Promise.allSettled(keys.map(key=>bucket().delete(key)));throw error;}
}
async function addDocument(owner:string,request:Request){
  if(Number(request.headers.get("content-length")||0)>6*1024*1024)throw new HttpError(413,"أقصى حجم للمستند 5 ميجابايت.");
  const f=await request.formData();const file=f.get("file");if(!(file instanceof File))throw new HttpError(400,"اختر ملفًا لإرفاقه.");
  if(file.size===0||file.size>5*1024*1024)throw new HttpError(413,"أقصى حجم للمستند 5 ميجابايت، ولا يقبل الملف الفارغ.");
  const caseId=String(f.get("caseId")||"");const record=await getCase(owner,caseId);
  const bytes=new Uint8Array(await file.arrayBuffer());const mime=detectedMime(bytes);
  if(!mime)throw new HttpError(415,"الملف غير مدعوم. استخدم PNG أو JPEG أو PDF صالحًا.");
  const fields=fieldsSchema.parse(JSON.parse(String(f.get("fields")||"{}")));
  const source=String(f.get("source")||"").trim();if(source.length<2||source.length>160)throw new HttpError(400,"أدخل مصدر المستند بوضوح.");
  const capturedAt=dateString.parse(String(f.get("capturedAt")||""));
  const type=String(f.get("type"));if(!["passport","travel_document"].includes(type))throw new HttpError(400,"نوع المستند غير صحيح.");
  if(f.get("synthetic")!=="true")throw new HttpError(400,"هذه النسخة مخصصة للبيانات التجريبية فقط.");
  const extractionMethod=f.get("extractionMethod")==="tesseract"?"tesseract":"manual";
  const text=String(f.get("extractedText")||"").slice(0,30_000);
  const rawConfidence=f.get("confidence");const confidence=rawConfidence&&Number.isFinite(Number(rawConfidence))?Math.max(0,Math.min(100,Number(rawConfidence))):null;
  const locations=locationSchema.parse(JSON.parse(String(f.get("locations")||"{}")));
  const sha=await hash(bytes);const duplicate=await db().prepare("SELECT id FROM documents WHERE case_id=? AND owner=? AND sha256=?").bind(caseId,owner,sha).first();
  if(duplicate)throw new HttpError(409,"هذا الملف محفوظ بالفعل ضمن الحالة.");
  const id=crypto.randomUUID();const key=`${owner}/${caseId}/${id}`;const now=new Date().toISOString();
  const doc={type,filename:file.name.slice(0,160),contentType:mime,size:file.size,source,capturedAt,fields,extractedText:text,confidence,locations,reviewStatus:"pending",reviewNote:"",reviewedAt:null,synthetic:true,extractionMethod};
  await bucket().put(key,bytes,{httpMetadata:{contentType:mime}});
  try{await db().batch([
    db().prepare("INSERT INTO documents (id,owner,case_id,object_key,sha256,data,revision,created_at) VALUES (?,?,?,?,?,?,1,?)").bind(id,owner,caseId,key,sha,JSON.stringify(doc),now),
    db().prepare("UPDATE cases SET updated_at=? WHERE id=? AND owner=?").bind(now,caseId,owner),
    audit(owner,caseId,"document_added",`إرفاق ${type==="passport"?"نسخة جواز":"وثيقة بديلة"} بالحالة ${record.reference}؛ بانتظار المراجعة`),
  ]);}catch(e){await bucket().delete(key);throw e;}
  return {id,caseId};
}
function packetHtml(record:CaseRecord,reviewed=false,preparedAt=new Date().toISOString()){
  const e=escapeHtml;const sections=record.documents.map(d=>`<section><h2>${d.type==="passport"?"نسخة الجواز":"الوثيقة البديلة"}</h2><p>المصدر: ${e(d.source)} • تاريخ التقديم: ${e(d.capturedAt)} • المراجعة: ${d.reviewStatus==="approved"?"راجعها الموظف":"تحتاج مراجعة"}</p><table>${Object.entries(d.fields).map(([k,v])=>`<tr><th>${e(({name:"الاسم",passportNumber:"رقم الوثيقة",nationality:"الجنسية حسب الوثيقة",birthDate:"الميلاد",expiryDate:"الانتهاء"} as Record<string,string>)[k])}</th><td dir="auto">${e(v||"غير متاح")}</td></tr>`).join("")}</table><p>ملاحظات المراجع: ${e(d.reviewNote||"لا توجد")}</p>${discrepancies(record,d).length?"<p class='warning'>توجد اختلافات بين بيانات الوثيقة وسجل الدخول؛ يلزم الرجوع إلى ملاحظات المراجع.</p>":""}${d.contentType.startsWith("image/")?`<img src="/api/documents/${d.id}/file" alt="مستند اصطناعي محفوظ"/>`:`<p><a href="/api/documents/${d.id}/file">فتح ملف PDF المرفق</a></p>`}<small>بصمة الملف SHA-256: <span dir="ltr">${d.sha256}</span></small></section>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>سَنَد — ${e(record.reference)}</title><style>body{font-family:Tahoma,Arial,sans-serif;color:#142e39;line-height:1.9;max-width:850px;margin:32px auto;padding:24px}header{border-bottom:3px solid #10756b}h1{font-size:26px}h2{font-size:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{width:33%;background:#f0f5f4}section{margin-top:30px;break-inside:avoid}img{width:100%;max-height:420px;object-fit:contain;margin:15px 0}small{overflow-wrap:anywhere}.warning{color:#854d0e;background:#fffbeb;padding:12px}.toolbar{display:flex;gap:12px}button{background:#10756b;color:white;border:0;padding:12px 20px;cursor:pointer;border-radius:8px;font:inherit}@media print{body{padding:0;margin:0;font-size:11pt}.toolbar{display:none}@page{size:A4;margin:16mm}img{max-height:340px}}</style><div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><a href="/">العودة لسَنَد</a></div><header><h1>سَنَد | ملف المستندات للمراجعة</h1><p>${e(record.reference)} • ${e(record.name)}</p></header><p class="warning">بيانات اصطناعية — نموذج هاكاثون. ${reviewed?"سُجلت مراجعة هذه الحزمة داخل النموذج.":"مسودة تحتاج مراجعة الموظف."} ليست وثيقة سفر ولا إثباتًا مستقلًا للجنسية.</p><table><tr><th>الاسم في سجل الدخول</th><td>${e(record.englishName)}</td></tr><tr><th>رقم الحدود التجريبي</th><td>${e(record.borderNumber)}</td></tr><tr><th>تاريخ الدخول</th><td>${e(record.entryDate)}</td></tr><tr><th>الملاحظات</th><td>${e(record.notes||"لا توجد")}</td></tr></table>${sections||"<p class='warning'>لا توجد مستندات مرفقة. لا يمكن استرجاع وثيقة لم تحفظ.</p>"}<footer><p>أُعدت الحزمة من السجلات المحفوظة في سَنَد. اعتماد المستندات وإصدار وثائق السفر من اختصاص الجهات المعنية.</p><small>تاريخ إعداد الحزمة: ${e(preparedAt)}</small></footer></html>`;
}
export async function handle(request:Request):Promise<Response>{
  try{
    if(new URL(request.url).pathname.startsWith("/api/auth/"))return await handleAuth(request);
    const user=await getCurrentUser(request);if(!user)throw new HttpError(401,"سجل الدخول للوصول إلى مساحة العمل.");
    const owner=user.userId;const url=new URL(request.url);const path=url.pathname.replace(/^\/api\/?/,"").split("/");const method=request.method;
    if(method!=="GET"){
      const origin=request.headers.get("origin");if(origin&&origin!==url.origin)throw new HttpError(403,"مصدر الطلب غير مسموح.");
      if(request.headers.get("sec-fetch-site")==="cross-site")throw new HttpError(403,"مصدر الطلب غير مسموح.");
    }
    if(path[0]==="state"&&method==="GET")return json(await state(owner));
    if(path[0]==="ai-config"&&method==="GET")return json(groqConfiguration(env));
    if(path[0]==="demo"&&method==="POST"){await seed(owner);return json(await state(owner),201);}
    if(path[0]==="cases"&&!path[1]&&method==="POST"){
      const input=newCaseSchema.parse(await body(request));const id=crypto.randomUUID();const now=new Date().toISOString();const reference=`SND-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
      const data={...input,consularStatus:"not_started"};
      await db().batch([db().prepare("INSERT INTO cases (id,owner,reference,data,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id,owner,reference,JSON.stringify(data),now,now),audit(owner,id,"case_created",`إنشاء الحالة ${reference}`)]);
      return json(await getCase(owner,id),201);
    }
    if(path[0]==="cases"&&path[1]&&method==="GET")return json(await getCase(owner,path[1]));
    if(path[0]==="cases"&&path[1]&&method==="PATCH"){
      const input=caseUpdateSchema.parse(await body(request));const record=await getCase(owner,path[1]);
      const row=await db().prepare("SELECT data FROM cases WHERE owner=? AND id=?").bind(owner,path[1]).first<{data:string}>();
      await db().batch([db().prepare("UPDATE cases SET data=?,updated_at=? WHERE owner=? AND id=?").bind(JSON.stringify({...JSON.parse(row!.data),...input}),new Date().toISOString(),owner,record.id),audit(owner,record.id,"case_updated",`تحديث متابعة الحالة ${record.reference}`)]);
      return json(await getCase(owner,path[1]));
    }
    if(path[0]==="documents"&&!path[1]&&method==="POST")return json(await addDocument(owner,request),201);
    if(path[0]==="documents"&&path[1]&&path[2]==="file"&&method==="GET"){
      const row=await documentRow(owner,path[1]);const doc=unpackDoc(row);const object=await bucket().get(row.object_key);if(!object)throw new HttpError(404,"بيانات المستند غير متاحة في مخزن الملفات.");
      return new Response(object.body,{headers:{...securityHeaders,"Content-Type":doc.contentType,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,"Content-Security-Policy":"sandbox; default-src 'none'; style-src 'unsafe-inline'"}});
    }
    if(path[0]==="documents"&&path[1]&&method==="PATCH"){
      const input=reviewSchema.parse(await body(request));const row=await documentRow(owner,path[1]);const now=new Date().toISOString();const doc={...JSON.parse(row.data),fields:input.fields,reviewStatus:input.reviewStatus,reviewNote:input.reviewNote,reviewedAt:input.reviewStatus==="pending"?null:now};
      const record=await getCase(owner,row.case_id);const differing=discrepancies(record,{...unpackDoc(row),fields:input.fields});
      if(input.reviewStatus==="approved"&&differing.length&&input.reviewNote.trim().length<8)throw new HttpError(400,"توجد اختلافات. سجل ملاحظة مراجعة توضحها قبل الاعتماد.");
      const results=await db().batch([
        db().prepare("UPDATE documents SET data=?,revision=revision+1 WHERE owner=? AND id=? AND revision=?").bind(JSON.stringify(doc),owner,row.id,input.revision),
        db().prepare("INSERT INTO audit_log (id,owner,case_id,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(),owner,row.case_id,"document_reviewed",`مراجعة المستند ${row.id.slice(0,8)} — ${input.reviewStatus==="approved"?"اعتماد مراجعة البيانات":input.reviewStatus==="needs_correction"?"طلب تصحيح":"إعادة للمراجعة"}`,now),
        db().prepare("UPDATE cases SET updated_at=? WHERE owner=? AND id=? AND changes()>0").bind(now,owner,row.case_id),
      ]);
      if(!results[0].meta.changes)throw new HttpError(409,"تغير المستند أثناء مراجعتك. حدّث الصفحة ثم أعد المحاولة.");
      return json(await getCase(owner,row.case_id));
    }
    if(path[0]==="assistant"&&method==="POST"){
      const input=assistantSchema.parse(await body(request));const record=await getCase(owner,input.caseId);
      const intent=directIntent(input.query)??(input.semantic?input.intent??null:null);
      const fallback=answerFromRecord(record,intent,input.semantic?"semantic":"direct");
      const answer=input.provider==="local"?fallback:await answerWithGroq(record,input.query,fallback,env);
      await audit(owner,record.id,"assistant_used",`مراجعة مستندات الملف؛ ${answer.mode==="generative"?"مسودة مولدة عبر Groq":answer.mode==="semantic"?"فهم دلالي محلي":"إجابة من السجل"}`).run();return json(answer);
    }
    if(path[0]==="packet-snapshots"&&path[1]&&method==="GET"){
      const snapshot=await db().prepare("SELECT snapshot,created_at FROM packet_reviews WHERE owner=? AND id=?").bind(owner,path[1]).first<{snapshot:string;created_at:string}>();
      if(!snapshot)throw new HttpError(404,"الحزمة غير متاحة لحسابك.");
      return new Response(packetHtml(JSON.parse(snapshot.snapshot),true,snapshot.created_at),{headers:{...securityHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'"}});
    }
    if(path[0]==="packet"&&path[1]&&path[2]==="history"&&method==="GET"){
      await getCase(owner,path[1]);
      const rows=await db().prepare("SELECT id,created_at AS createdAt FROM packet_reviews WHERE owner=? AND case_id=? ORDER BY created_at DESC").bind(owner,path[1]).all();return json(rows.results);
    }
    if(path[0]==="packet"&&path[1]&&method==="GET"){
      const record=await getCase(owner,path[1]);await audit(owner,record.id,"packet_opened",`فتح مسودة حزمة المراجعة ${record.reference}`).run();
      return new Response(packetHtml(record),{headers:{...securityHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'"}});
    }
    if(path[0]==="packet"&&path[1]&&method==="POST"){
      const record=await getCase(owner,path[1]);if(!record.documents.length||record.documents.some(d=>d.reviewStatus!=="approved"))throw new HttpError(400,"راجع جميع المستندات المرفقة قبل تسجيل مراجعة الحزمة.");
      const now=new Date().toISOString();const id=crypto.randomUUID();
      await db().batch([db().prepare("INSERT INTO packet_reviews (id,owner,case_id,snapshot,created_at) VALUES (?,?,?,?,?)").bind(id,owner,record.id,JSON.stringify(record),now),audit(owner,record.id,"packet_reviewed",`سُجلت مراجعة حزمة ${record.reference} مع نسخة ثابتة من البيانات`)]);return json({id,createdAt:now});
    }
    throw new HttpError(404,"المسار غير موجود.");
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status);
    if(error instanceof ZodError)return json({error:error.issues.map(x=>`${x.path.join(".")}: ${x.message}`).join("؛ ")},400);
    if(error instanceof SyntaxError)return json({error:"تعذر قراءة بيانات الطلب."},400);
    console.error("sanad_request_failed",error instanceof Error?error.name:"unknown");return json({error:"تعذر إكمال العملية. بياناتك المدخلة محفوظة في الشاشة؛ حاول مجددًا."},503);
  }
}
