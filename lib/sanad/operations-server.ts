import type { CaseRecord, StoredDocument } from "./types";
import { intakeSchema, intakeReviewSchema, arrivalSchema, transitionSchema, directiveSchema, directiveUpdateSchema, directiveReadiness, directiveTypes, type IntakeRecord, type IntakeFile, type DirectiveRecord } from "./operations";
import { emptyDetails, emptyLeg } from "./traveler";
import { detectedMime } from "./validation";
import { escapeHtml } from "./domain";
import { documentStore } from "./storage";

export class OperationsError extends Error { constructor(public status: number, message: string) { super(message); } }
type Row = { id: string; data: string; revision: number; case_id?: string };
type InternalIntake = Omit<IntakeRecord, "file"> & { file: IntakeFile; payloadHash: string; arrivalHash?: string };
type Context = { database: D1Database; owner: string; request: Request; path: string[]; method: string; getCase: (id: string) => Promise<CaseRecord>; audit: (caseId: string | null, action: string, detail: string) => D1PreparedStatement };
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
const json = (v: unknown, status = 200) => Response.json(v, { status, headers });
async function body(request: Request) { const raw = await request.text(); if (raw.length > 40_000) throw new OperationsError(413, "الطلب أكبر من الحد المسموح"); return JSON.parse(raw); }
async function hash(bytes: Uint8Array) { const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource); return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join(""); }
const hashText = (value: unknown) => hash(new TextEncoder().encode(JSON.stringify(value)));
function unpackIntake(row: Row): InternalIntake { return { ...JSON.parse(row.data), id: row.id, revision: row.revision }; }
function publicIntake(r: InternalIntake): IntakeRecord { const { payloadHash, arrivalHash, file, ...rest } = r; const { objectKey, ...publicFile } = file; return { ...rest, file: publicFile }; }
function unpackDirective(row: Row): DirectiveRecord { const { payloadHash, ...data } = JSON.parse(row.data); return { ...data, id: row.id, caseId: row.case_id!, revision: row.revision }; }

export async function operationsHandle(ctx: Context): Promise<Response | null> {
  const { database: db, owner, request, path, method } = ctx, store = documentStore(db);
  async function intake(id: string) { const row = await db.prepare("SELECT * FROM intake_requests WHERE owner=? AND id=?").bind(owner, id).first<Row>(); if (!row) throw new OperationsError(404, "طلب ما قبل الوصول غير متاح لحسابك"); return unpackIntake(row); }
  async function saveIntake(record: InternalIntake, expected: number, action: string) {
    const { revision, ...data } = { ...record, updatedAt: new Date().toISOString() };
    const results = await db.batch([db.prepare("UPDATE intake_requests SET data=?,revision=revision+1 WHERE owner=? AND id=? AND revision=?").bind(JSON.stringify(data), owner, record.id, expected), db.prepare("INSERT INTO audit_log (id,owner,case_id,action,detail,created_at) SELECT ?,?,NULL,?,?,? WHERE changes()>0").bind(crypto.randomUUID(), owner, action, `${action === "intake_reviewed" ? "مراجعة نسخة قبل الوصول" : action === "intake_queued" ? "تسليم نسخة إلى قناة الربط التجريبية" : "استلام نسخة داخل محاكاة سَنَد"}: ${record.reference}`, new Date().toISOString())]);
    if (!results[0].meta.changes) throw new OperationsError(409, "تغير الطلب أثناء العمل. حدّث القائمة قبل إعادة المحاولة.");
    return json(publicIntake(await intake(record.id)));
  }
  if (path[0] === "intake" && !path[1] && method === "GET") {
    const rows = await db.prepare("SELECT * FROM intake_requests WHERE owner=? ORDER BY rowid DESC").bind(owner).all<Row>(); return json(rows.results.map(r => publicIntake(unpackIntake(r))));
  }
  if (path[0] === "intake" && !path[1] && method === "POST") {
    if (Number(request.headers.get("content-length") || 0) > 6 * 1024 * 1024) throw new OperationsError(413, "أقصى حجم للنسخة 5 ميجابايت");
    const form = await request.formData(), file = form.get("file"), raw = String(form.get("metadata") || "");
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024 || raw.length > 40_000) throw new OperationsError(400, "أرفق صورة أو PDF حتى 5 ميجابايت مع البيانات التجريبية");
    const input = intakeSchema.parse(JSON.parse(raw)), bytes = new Uint8Array(await file.arrayBuffer()), mime = detectedMime(bytes);
    if (!mime) throw new OperationsError(415, "استخدم صورة PNG أو JPEG أو PDF صالحًا");
    const sha256 = await hash(bytes), payloadHash = await hashText({ input, sha256 });
    async function existing() { return db.prepare("SELECT * FROM intake_requests WHERE owner=? AND request_key=?").bind(owner, input.requestKey).first<Row>(); }
    const prior = await existing();
    if (prior) { const r = unpackIntake(prior); if (r.payloadHash !== payloadHash) throw new OperationsError(409, "مفتاح الطلب مستخدم لبيانات مختلفة"); return json(publicIntake(r)); }
    if (await db.prepare("SELECT id FROM intake_requests WHERE owner=? AND visa_number=?").bind(owner, input.visaNumber).first()) throw new OperationsError(409, "رقم التأشيرة مستخدم في طلب محفوظ. افتح الطلب الحالي.");
    const count = await db.prepare("SELECT count(*) AS total FROM intake_requests WHERE owner=?").bind(owner).first<{ total: number }>(); if ((count?.total || 0) >= 200) throw new OperationsError(400, "الحد التجريبي 200 طلب قبل الوصول");
    const id = crypto.randomUUID(), now = new Date().toISOString(), objectKey = `${owner}/intake/${id}`;
    const { requestKey, ...data } = input;
    const record: InternalIntake = { ...data, id, reference: `PRE-${id.slice(0, 8).toUpperCase()}`, revision: 1, status: "saved", file: { filename: file.name.slice(0, 160), contentType: mime, size: bytes.length, sha256, objectKey }, reviewNote: "", reviewedAt: null, createdAt: now, updatedAt: now, messageId: null, queuedAt: null, receivedAt: null, caseId: null, payloadHash };
    await store.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
    try { await db.batch([db.prepare("INSERT INTO intake_requests (id,owner,request_key,visa_number,data,revision) VALUES (?,?,?,?,?,1)").bind(id, owner, requestKey, input.visaNumber, JSON.stringify(record)), ctx.audit(null, "intake_saved", `حفظ نسخة قبل الوصول — محاكاة: ${record.reference}`)]); }
    catch (error) { await store.delete(objectKey); const r = await existing(); if (r && unpackIntake(r).payloadHash === payloadHash) return json(publicIntake(unpackIntake(r))); if (await db.prepare("SELECT id FROM intake_requests WHERE owner=? AND visa_number=?").bind(owner, input.visaNumber).first()) throw new OperationsError(409, "رقم التأشيرة مستخدم في طلب محفوظ"); throw error; }
    return json(publicIntake(record), 201);
  }
  if (path[0] === "intake" && path[1]) {
    const r = await intake(path[1]);
    if (!path[2] && method === "GET") return json(publicIntake(r));
    if (path[2] === "file" && method === "GET") { const object = await store.get(r.file.objectKey); if (!object) throw new OperationsError(404, "النسخة غير متاحة"); return new Response(object.body, { headers: { ...headers, "Content-Type": r.file.contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.file.filename)}`, "Content-Security-Policy": "sandbox; default-src 'none'" } }); }
    if (path[2] === "review" && method === "PATCH") {
      const input = intakeReviewSchema.parse(await body(request)); if (!["saved", "reviewed"].includes(r.status)) throw new OperationsError(409, "سُلّمت النسخة بالفعل. مراجعة النسخة المرتبطة تتم داخل ملف الحالة بعد الوصول.");
      if (input.fields.birthDate >= r.capturedAt) throw new OperationsError(400, "تاريخ الميلاد يجب أن يسبق حفظ النسخة");
      return saveIntake({ ...r, fields: input.fields, reviewNote: input.reviewNote, status: "reviewed", reviewedAt: new Date().toISOString() }, input.revision, "intake_reviewed");
    }
    if (path[2] === "dispatch" && method === "POST") {
      const input = transitionSchema.parse(await body(request)); if (["queued", "received", "arrived"].includes(r.status)) return json(publicIntake(r));
      if (r.status !== "reviewed") throw new OperationsError(400, "راجع النسخة قبل تسليمها في المحاكاة");
      return saveIntake({ ...r, status: "queued", queuedAt: new Date().toISOString(), messageId: `SIM-${crypto.randomUUID()}` }, input.revision, "intake_queued");
    }
    if (path[2] === "receive" && method === "POST") {
      const input = transitionSchema.parse(await body(request)); if (["received", "arrived"].includes(r.status)) return json(publicIntake(r));
      if (r.status !== "queued") throw new OperationsError(400, "سلّم الطلب إلى قناة الربط التجريبية أولًا");
      return saveIntake({ ...r, status: "received", receivedAt: new Date().toISOString() }, input.revision, "intake_received");
    }
    if (path[2] === "arrival" && method === "POST") {
      const input = arrivalSchema.parse(await body(request)), { revision, ...arrival } = input, arrivalHash = await hashText(arrival);
      if (r.status === "arrived" && r.caseId) { if (arrivalHash !== r.arrivalHash) throw new OperationsError(409, "سجل الدخول موجود ببيانات مختلفة؛ افتح الحالة لمراجعته"); return json(await ctx.getCase(r.caseId)); }
      if (r.status !== "received") throw new OperationsError(400, "أكمل استلام النسخة في المحاكاة قبل تسجيل الدخول");
      if (input.entryDate < r.capturedAt || input.entryDate <= r.fields.birthDate) throw new OperationsError(400, "الدخول يجب ألا يسبق حفظ النسخة قبل الوصول أو تاريخ الميلاد");
      if (await db.prepare("SELECT id FROM cases WHERE owner=? AND json_extract(data,'$.visaNumber')=?").bind(owner, r.visaNumber).first()) throw new OperationsError(409, "توجد حالة برقم التأشيرة نفسه؛ راجعها قبل إنشاء سجل آخر");
      const caseId = crypto.randomUUID(), documentId = crypto.randomUUID(), movementId = crypto.randomUUID(), now = new Date().toISOString(), reference = `SND-${new Date().getUTCFullYear()}-${caseId.slice(0, 8).toUpperCase()}`;
      const record = { name: r.name, englishName: r.englishName, borderNumber: input.borderNumber, visaNumber: r.visaNumber, passportNumber: r.fields.passportNumber, nationality: r.fields.nationality, birthDate: r.fields.birthDate, entryDate: input.entryDate, visaType: r.visaType, port: input.port, notes: `نسخة محفوظة قبل الوصول عبر ${r.reference} — محاكاة فقط`, consularStatus: "not_started", synthetic: true };
      const document: Omit<StoredDocument, "id" | "caseId" | "sha256" | "createdAt" | "revision"> = { type: "passport", filename: r.file.filename, contentType: r.file.contentType, size: r.file.size, source: `محاكاة قبل الوصول: ${r.issuer} / ${r.reference}`, capturedAt: r.capturedAt, fields: r.fields, extractedText: "", confidence: null, locations: {}, reviewStatus: "approved", reviewNote: r.reviewNote, reviewedAt: r.reviewedAt, synthetic: true, extractionMethod: "manual" };
      const details = emptyDetails(); details.revision = 1; details.profile.source = `محاكاة قبل الوصول: ${r.reference}`; details.profile.values.documentType = "جواز سفر"; details.profile.values.visaIssuePlace = r.issuer; details.profile.dates.passportExpiryDate = { value: r.fields.expiryDate, calendar: "gregorian" }; details.latestEntryId = movementId;
      details.movements = [{ id: movementId, reference: input.movementReference, visaNumber: r.visaNumber, source: `تسجيل دخول تجريبي / ${r.reference}`, entry: { ...emptyLeg(), date: { value: input.entryDate, calendar: "gregorian" }, time: input.time, location: input.port, transport: input.transport, direction: input.direction, carrier: input.carrier, operatorNumber: input.operatorNumber, documentNumber: input.documentNumber, documentId }, exit: emptyLeg(), createdAt: now, updatedAt: now }];
      const next = { ...r, status: "arrived", caseId, arrivalHash, updatedAt: now };
      const results = await db.batch([
        db.prepare("UPDATE intake_requests SET data=?,revision=revision+1 WHERE owner=? AND id=? AND revision=?").bind(JSON.stringify(next), owner, r.id, revision),
        db.prepare("INSERT INTO cases (id,owner,reference,data,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(caseId, owner, reference, JSON.stringify(record), now, now),
        db.prepare("INSERT INTO documents (id,owner,case_id,object_key,sha256,data,revision,created_at) SELECT ?,?,?,?,?,?,1,? WHERE changes()>0").bind(documentId, owner, caseId, r.file.objectKey, r.file.sha256, JSON.stringify(document), now),
        db.prepare("INSERT INTO case_details (case_id,owner,data,revision) SELECT ?,?,?,1 WHERE changes()>0").bind(caseId, owner, JSON.stringify(details)),
        db.prepare("INSERT INTO audit_log (id,owner,case_id,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(), owner, caseId, "intake_arrived", `ربط نسخة محفوظة قبل الوصول بسجل دخول تجريبي: ${r.reference}`, now),
      ]);
      if (!results[0].meta.changes) { const current = await intake(r.id); if (current.caseId && current.arrivalHash === arrivalHash) return json(await ctx.getCase(current.caseId)); throw new OperationsError(409, "تغير طلب الوصول أثناء العمل؛ حدّث القائمة"); }
      return json(await ctx.getCase(caseId), 201);
    }
  }
  if (path[0] === "cases" && path[1] && path[2] === "directives" && !path[3]) {
    const record = await ctx.getCase(path[1]);
    if (method === "GET") { const rows = await db.prepare("SELECT * FROM directive_records WHERE owner=? AND case_id=? ORDER BY rowid DESC").bind(owner, record.id).all<Row>(); return json(rows.results.map(unpackDirective)); }
    if (method === "POST") {
      const input = directiveSchema.parse(await body(request));
      if (input.documentIds.some(id => !record.documents.some(d => d.id === id))) throw new OperationsError(400, "اختر وثائق من الحالة الحالية فقط");
      const payloadHash = await hashText(input), { requestKey, ...data } = input, id = crypto.randomUUID(), now = new Date().toISOString();
      const prior = await db.prepare("SELECT * FROM directive_records WHERE owner=? AND request_key=?").bind(owner, requestKey).first<Row>();
      if (prior) { if (prior.case_id !== record.id || JSON.parse(prior.data).payloadHash !== payloadHash) throw new OperationsError(409, "مفتاح الطلب مستخدم لبيانات مختلفة"); return json(unpackDirective(prior)); }
      const directive = { ...data, id, caseId: record.id, revision: 1, createdAt: now, preparedAt: null, snapshot: null, payloadHash };
      try { await db.batch([db.prepare("INSERT INTO directive_records (id,owner,case_id,request_key,reference,data,revision) VALUES (?,?,?,?,?,?,1)").bind(id, owner, record.id, requestKey, data.reference, JSON.stringify(directive)), ctx.audit(record.id, "directive_saved", `حفظ مرجع وارد تجريبي ${data.reference} — دون تنفيذ إجراء`)]); }
      catch (error) { if (await db.prepare("SELECT id FROM directive_records WHERE case_id=? AND reference=?").bind(record.id, data.reference).first()) throw new OperationsError(409, "مرجع الأمر محفوظ بالفعل في الحالة"); throw error; }
      return json(unpackDirective({ id, case_id: record.id, revision: 1, data: JSON.stringify(directive) }), 201);
    }
  }
  if (path[0] === "directives" && path[1]) {
    const row = await db.prepare("SELECT * FROM directive_records WHERE owner=? AND id=?").bind(owner, path[1]).first<Row>(); if (!row) throw new OperationsError(404, "مرجع الأمر غير متاح لحسابك");
    const directive = unpackDirective(row), record = await ctx.getCase(directive.caseId);
    if (!path[2] && method === "PATCH") {
      const { revision, ...input } = directiveUpdateSchema.parse(await body(request));
      if (directive.preparedAt) throw new OperationsError(409, "الحزمة ثابتة بعد تجهيزها. أضف مرجعًا جديدًا للتصحيح.");
      if (input.documentIds.some(id => !record.documents.some(d => d.id === id))) throw new OperationsError(400, "اختر وثائق من الحالة الحالية فقط");
      if (await db.prepare("SELECT id FROM directive_records WHERE case_id=? AND reference=? AND id<>?").bind(record.id, input.reference, row.id).first()) throw new OperationsError(409, "مرجع الأمر مستخدم في الحالة");
      const data = { ...JSON.parse(row.data), ...input };
      const results = await db.batch([db.prepare("UPDATE directive_records SET data=?,reference=?,revision=revision+1 WHERE owner=? AND id=? AND revision=?").bind(JSON.stringify(data), input.reference, owner, row.id, revision), db.prepare("INSERT INTO audit_log (id,owner,case_id,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(), owner, record.id, "directive_updated", `تحديث مستندات مرجع تجريبي ${input.reference}`, new Date().toISOString())]);
      if (!results[0].meta.changes) throw new OperationsError(409, "تغير المرجع أثناء التعديل؛ حدّث القائمة");
      return json(unpackDirective({ ...row, data: JSON.stringify(data), revision: row.revision + 1 }));
    }
    if (path[2] === "prepare" && method === "POST") {
      const input = transitionSchema.parse(await body(request)); if (directive.preparedAt) return json(directive);
      const readiness = directiveReadiness(record, directive.documentIds); if (!readiness.ready) throw new OperationsError(400, `الحزمة تحتاج: ${readiness.missing.join("، ")}`);
      const next = { ...JSON.parse(row.data), preparedAt: new Date().toISOString(), snapshot: { caseReference: record.reference, caseName: record.name, documents: readiness.documents } };
      const results = await db.batch([db.prepare("UPDATE directive_records SET data=?,revision=revision+1 WHERE owner=? AND id=? AND revision=?").bind(JSON.stringify(next), owner, row.id, input.revision), db.prepare("INSERT INTO audit_log (id,owner,case_id,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(), owner, record.id, "directive_prepared", `حفظ لقطة مستندات مرجع ${directive.reference} — لا يفعّل منعًا أو إبعادًا`, next.preparedAt)]);
      if (!results[0].meta.changes) throw new OperationsError(409, "تغير المرجع أثناء التجهيز؛ حدّث القائمة");
      return json(unpackDirective({ ...row, data: JSON.stringify(next), revision: row.revision + 1 }));
    }
    if (path[2] === "print" && method === "GET") {
      const e = escapeHtml, docs = directive.snapshot?.documents || record.documents.filter(d => directive.documentIds.includes(d.id));
      const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>سَنَد — مرجع أمر تجريبي</title><style>body{font-family:Tahoma,Arial;max-width:850px;margin:30px auto;padding:20px;line-height:1.9;color:#183a43}header{border-bottom:3px solid #10756b}section{break-inside:avoid;border:1px solid #d9e4e2;padding:18px;margin:20px 0}img{max-width:100%;max-height:350px}small{overflow-wrap:anywhere}.note{background:#fff8e7;padding:14px}button{padding:12px;background:#10756b;color:white;border:0;font:inherit}@media print{button{display:none}@page{size:A4;margin:16mm}}</style><button onclick="print()">طباعة / حفظ PDF</button><header><h1>سَنَد | ${e(directiveTypes[directive.type])}</h1><p>${e(directive.reference)} · ${e(directive.snapshot?.caseReference || record.reference)}</p></header><p class="note">بيانات وهمية ومحاكاة فقط. هذا سجل مستندات لمرجع وارد، ولا يصدر أو ينفذ أمرًا أو يفعّل منع دخول.</p><p>المصدر المدخل: ${e(directive.source)} • التاريخ: <bdi>${e(directive.date.value)}</bdi> ${directive.date.calendar === "hijri" ? "هجري" : "ميلادي"}</p><p>${e(directive.notes)}</p><p>${directive.preparedAt ? `لقطة محفوظة بتاريخ ${e(directive.preparedAt)}` : "مسودة غير مثبتة؛ تعكس الوثائق الحالية"}</p>${docs.map(d => `<section><h2>${d.type === "passport" ? "نسخة الجواز" : "الوثيقة البديلة"}</h2><p>${e(d.filename)} · ${e(d.source)}</p><p>رقم الوثيقة: <bdi>${e(d.fields.passportNumber)}</bdi> · مراجعة البيانات: ${d.reviewStatus === "approved" ? "راجعها الموظف" : "تحتاج مراجعة"}</p>${d.contentType.startsWith("image/") ? `<img src="/api/documents/${encodeURIComponent(d.id)}/file" alt="نسخة اصطناعية محفوظة">` : `<a href="/api/documents/${encodeURIComponent(d.id)}/file">فتح ملف PDF المرتبط</a>`}<p>ملاحظة المراجع: ${e(d.reviewNote)}</p><small>SHA-256: <bdi>${e(d.sha256)}</bdi></small></section>`).join("") || "<p>لم تُربط وثائق بعد.</p>"}</html>`;
      return new Response(html, { headers: { ...headers, "Content-Type": "text/html;charset=utf-8", "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'" } });
    }
  }
  return null;
}
