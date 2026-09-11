import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), reference: text("reference").notNull(),
  data: text("data").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t=>[index("cases_owner_updated").on(t.owner,t.updatedAt),uniqueIndex("cases_owner_reference").on(t.owner,t.reference)]);
export const documents = sqliteTable("documents", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), caseId:text("case_id").notNull().references(()=>cases.id),
  objectKey:text("object_key").notNull(), sha256:text("sha256").notNull(), data:text("data").notNull(),
  revision:integer("revision").notNull().default(1), createdAt:text("created_at").notNull(),
}, t=>[index("documents_owner_case").on(t.owner,t.caseId),uniqueIndex("documents_case_sha").on(t.caseId,t.sha256)]);
export const auditLog = sqliteTable("audit_log", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), caseId:text("case_id"), action:text("action").notNull(),
  detail:text("detail").notNull(), createdAt:text("created_at").notNull(),
},t=>[index("audit_owner_created").on(t.owner,t.createdAt)]);
export const packetReviews = sqliteTable("packet_reviews", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), caseId:text("case_id").notNull().references(()=>cases.id),
  snapshot:text("snapshot").notNull(), createdAt:text("created_at").notNull(),
}, t=>[index("packets_owner_case").on(t.owner,t.caseId)]);
