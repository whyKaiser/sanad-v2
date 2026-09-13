import { sqliteTable, text, integer, blob, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), reference: text("reference").notNull(),
  data: text("data").notNull(), revision: integer("revision").notNull().default(1), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t=>[index("cases_owner_updated").on(t.owner,t.updatedAt),uniqueIndex("cases_owner_reference").on(t.owner,t.reference)]);
export const documents = sqliteTable("documents", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), caseId:text("case_id").notNull().references(()=>cases.id),
  objectKey:text("object_key").notNull(), sha256:text("sha256").notNull(), data:text("data").notNull(),
  revision:integer("revision").notNull().default(1), createdAt:text("created_at").notNull(),
}, t=>[index("documents_owner_case").on(t.owner,t.caseId),uniqueIndex("documents_case_sha").on(t.caseId,t.sha256)]);
export const caseDetails = sqliteTable("case_details", {
  caseId: text("case_id").primaryKey().references(()=>cases.id,{onDelete:"cascade"}),
  owner: text("owner").notNull(), data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
}, t=>[index("case_details_owner").on(t.owner)]);
export const intakeRequests = sqliteTable("intake_requests", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), requestKey: text("request_key").notNull(), visaNumber: text("visa_number").notNull(),
  data: text("data").notNull(), revision: integer("revision").notNull().default(1),
}, t=>[uniqueIndex("intake_owner_request").on(t.owner,t.requestKey),uniqueIndex("intake_owner_visa").on(t.owner,t.visaNumber)]);
export const directiveRecords = sqliteTable("directive_records", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), caseId: text("case_id").notNull().references(()=>cases.id,{onDelete:"cascade"}),
  requestKey: text("request_key").notNull(), reference: text("reference").notNull(), data: text("data").notNull(), revision: integer("revision").notNull().default(1),
}, t=>[uniqueIndex("directive_owner_request").on(t.owner,t.requestKey),uniqueIndex("directive_case_reference").on(t.caseId,t.reference),index("directive_owner_case").on(t.owner,t.caseId)]);
export const auditLog = sqliteTable("audit_log", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), caseId:text("case_id"), action:text("action").notNull(),
  detail:text("detail").notNull(), createdAt:text("created_at").notNull(),
},t=>[index("audit_owner_created").on(t.owner,t.createdAt)]);
export const packetReviews = sqliteTable("packet_reviews", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), caseId:text("case_id").notNull().references(()=>cases.id),
  snapshot:text("snapshot").notNull(), createdAt:text("created_at").notNull(),
}, t=>[index("packets_owner_case").on(t.owner,t.caseId)]);

export const authSessions=sqliteTable("auth_sessions",{
  tokenHash:text("token_hash").primaryKey(),owner:text("owner").notNull(),username:text("username").notNull(),authVersion:text("auth_version").notNull(),expiresAt:integer("expires_at").notNull(),
},t=>[index("auth_sessions_expiry").on(t.expiresAt)]);
export const authAttempts=sqliteTable("auth_attempts",{
  id:text("id").primaryKey(),attempts:integer("attempts").notNull(),expiresAt:integer("expires_at").notNull(),
},t=>[index("auth_attempts_expiry").on(t.expiresAt)]);
export const storedObjects=sqliteTable("stored_objects",{
  id:text("id").primaryKey(),contentType:text("content_type").notNull(),size:integer("size").notNull(),createdAt:text("created_at").notNull(),
});
export const objectChunks=sqliteTable("object_chunks",{
  objectId:text("object_id").notNull().references(()=>storedObjects.id,{onDelete:"cascade"}),chunkIndex:integer("chunk_index").notNull(),data:blob("data").notNull(),
},t=>[primaryKey({columns:[t.objectId,t.chunkIndex]})]);

// SQL migrations additionally install the journal and append-only triggers.
export const staffUsers=sqliteTable("staff_users",{
 id:text("id").primaryKey(),owner:text("owner").notNull(),username:text("username").notNull().unique(),displayName:text("display_name").notNull(),passwordHash:text("password_hash").notNull(),role:text("role",{enum:["admin","reviewer","officer","viewer"]}).notNull(),active:integer("active").notNull().default(1),revision:integer("revision").notNull().default(1),authVersion:text("auth_version").notNull(),createdAt:text("created_at").notNull(),
},t=>[index("staff_owner").on(t.owner)]);
export const workflowCases=sqliteTable("workflow_cases",{
 caseId:text("case_id").primaryKey().references(()=>cases.id),owner:text("owner").notNull(),data:text("data").notNull(),revision:integer("revision").notNull().default(1),
});
export const operationalDecisions=sqliteTable("operational_decisions",{
 id:text("id").primaryKey(),owner:text("owner").notNull(),data:text("data").notNull(),createdAt:text("created_at").notNull(),
});
export const workspaceSettings=sqliteTable("workspace_settings",{
 owner:text("owner").primaryKey(),data:text("data").notNull(),revision:integer("revision").notNull().default(1),
});
export const securityEvents=sqliteTable("security_events",{
 id:text("id").primaryKey(),owner:text("owner").notNull(),actor:text("actor").notNull(),kind:text("kind").notNull(),detail:text("detail").notNull(),createdAt:text("created_at").notNull(),
},t=>[index("security_owner_time").on(t.owner,t.createdAt)]);
export const mutationContext=sqliteTable("mutation_context",{
 owner:text("owner").primaryKey(),token:text("token").notNull(),actor:text("actor").notNull(),actorName:text("actor_name").notNull(),reason:text("reason").notNull(),action:text("action").notNull(),expiresAt:integer("expires_at").notNull(),
});
export const changeJournal=sqliteTable("change_journal",{
 id:integer("id").primaryKey({autoIncrement:true}),owner:text("owner").notNull(),requestId:text("request_id").notNull(),actor:text("actor").notNull(),actorName:text("actor_name").notNull(),entity:text("entity").notNull(),entityId:text("entity_id").notNull(),caseId:text("case_id"),operation:text("operation").notNull(),reason:text("reason").notNull(),beforeData:text("before_data"),afterData:text("after_data"),createdAt:text("created_at").notNull(),
},t=>[index("journal_owner_id").on(t.owner,t.id)]);
export const journalSignatures=sqliteTable("journal_signatures",{
 eventId:integer("event_id").primaryKey().references(()=>changeJournal.id),owner:text("owner").notNull(),previous:text("previous").notNull(),signature:text("signature").notNull(),
});
