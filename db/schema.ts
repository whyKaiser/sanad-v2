import { sqliteTable, text, integer, blob, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), reference: text("reference").notNull(),
  data: text("data").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
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
