import test from "node:test";
import assert from "node:assert/strict";
import { answerWithGroq, groqConfiguration } from "../lib/sanad/groq";
import { answerFromRecord } from "../lib/sanad/domain";
import { demoRecord } from "../lib/sanad/demo";
import type { CaseRecord, StoredDocument } from "../lib/sanad/types";
const record = { ...demoRecord(0), id: "groq-test", reference: "GROQ-TEST", documents: [], status: "ready", createdAt: "2026-09-11", updatedAt: "2026-09-11" } as CaseRecord;
record.documents = [{ id: "document-1", caseId: record.id, type: "passport", fields: { name: record.englishName, passportNumber: record.passportNumber, nationality: record.nationality, birthDate: record.birthDate, expiryDate: "2030-04-12" }, source: "عينة اصطناعية", capturedAt: "2026-09-11", synthetic: true, reviewStatus: "approved", extractedText: "RAW OCR MUST NOT LEAVE SERVER", sha256: "PRIVATE HASH" } as StoredDocument];
const fallback = answerFromRecord(record, "summary");
const environment = { GROQ_API_KEY: "test-secret-not-real" };
const never: typeof fetch = async () => { throw Error("Unexpected provider call"); };
function response(value: unknown) { return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }); }
test("Missing key remains local and public configuration never exposes it", async () => {
  assert.equal(await answerWithGroq(record, "لخص الملف", fallback, {}, never), fallback);
  assert.equal(groqConfiguration(environment).generativeConfigured, true);
  assert.ok(!JSON.stringify(groqConfiguration(environment)).includes(environment.GROQ_API_KEY));
});
test("Groq uses server authorization, minimal evidence, validated references and a human-review draft", async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(init?.redirect, "manual", "Workers supports manual redirect handling, and credentials must never follow redirects");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret-not-real");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(!JSON.stringify(body).includes("RAW OCR MUST NOT LEAVE SERVER"));
    assert.ok(!JSON.stringify(body).includes("PRIVATE HASH"));
    return response({ text: "توجد نسخة جواز محفوظة؛ راجع المراجع المرفقة.", evidenceIds: ["document-1:name"] });
  };
  const result = await answerWithGroq(record, "لخص الملف", fallback, environment, request);
  assert.equal(result.mode, "generative"); assert.equal(result.verifiedText, fallback.text); assert.match(result.warning!, /مسودة/);
  assert.deepEqual(result.evidence, fallback.evidence);
});
test("Invented references discard generated text", async () => {
  const result = await answerWithGroq(record, "لخص الملف", fallback, environment, async () => response({ text: "UNTRUSTED ANSWER", evidenceIds: ["foreign-document:name"] }));
  assert.equal(result.mode, "direct"); assert.equal(result.text, fallback.text); assert.match(result.warning!, /تعذر/);
});
test("Rate limit, rejected key and provider outage return grounded answers without leaking provider bodies", async () => {
  for (const status of [302, 307, 429, 401, 403, 503]) {
    const result = await answerWithGroq(record, "لخص الملف", fallback, environment, async () => new Response("SECRET PROVIDER BODY", { status }));
    assert.equal(result.mode, "direct"); assert.equal(result.text, fallback.text); assert.ok(result.warning); assert.ok(!JSON.stringify(result).includes("SECRET PROVIDER BODY"));
  }
});
test("Unsupported question is classified without sending record data", async () => {
  let calls = 0;
  const result = await answerWithGroq(record, "كم سعر الذهب؟", fallback, environment, async (_, init) => {
    calls++; assert.ok(!String(init?.body).includes(record.passportNumber)); return response({ intent: "unsupported" });
  });
  assert.equal(calls, 1); assert.deepEqual(result.evidence, []); assert.match(result.title, /لا توجد إجابة/);
});
test("A new phrasing can be classified and drafted through Groq", async () => {
  let calls = 0;
  const result = await answerWithGroq(record, "عطني الزبدة", fallback, environment, async () => ++calls === 1 ? response({ intent: "summary" }) : response({ text: "توجد نسخة جواز محفوظة في الملف.", evidenceIds: ["document-1:name"] }));
  assert.equal(calls, 2); assert.equal(result.mode, "generative");
});
test("Nationality, enforcement, absent originals and non-synthetic cases bypass generation", async () => {
  const nationality = await answerWithGroq(record, "ما الجنسية حسب الوثيقة؟", fallback, environment, never);
  assert.match(nationality.text, /لا تمثل قرارًا مستقلًا/); assert.equal(nationality.mode, "direct");
  const enforcement = await answerWithGroq(record, "هل تقرر ترحيل هذا الشخص؟", fallback, environment, never);
  assert.match(enforcement.text, /لا أقرر/);
  const missing = await answerWithGroq({ ...record, documents: [] }, "اعرض الجواز", fallback, environment, never);
  assert.match(missing.text, /لا يمكن استعادة/);
  const real = await answerWithGroq({ ...record, synthetic: false }, "لخص الملف", fallback, environment, never);
  assert.match(real.warning!, /الاصطناعية فقط/);
});
test("Malformed, truncated, and timed-out responses fail closed to the record", async () => {
  for (const request of [async () => new Response("not json"), async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }), async () => { throw new DOMException("timeout", "TimeoutError"); }]) {
    const result = await answerWithGroq(record, "لخص الملف", fallback, environment, request);
    assert.equal(result.text, fallback.text); assert.equal(result.mode, "direct"); assert.ok(result.warning);
  }
});
