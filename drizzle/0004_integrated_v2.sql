ALTER TABLE cases ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE staff_users (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','reviewer','officer','viewer')),
 active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
 auth_version TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX staff_owner ON staff_users(owner);
CREATE TABLE workflow_cases (case_id TEXT PRIMARY KEY REFERENCES cases(id),owner TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE operational_decisions (id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE workspace_settings (owner TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE security_events (id TEXT PRIMARY KEY,owner TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX security_owner_time ON security_events(owner,created_at);
CREATE TABLE mutation_context (
 owner TEXT PRIMARY KEY, token TEXT NOT NULL, actor TEXT NOT NULL, actor_name TEXT NOT NULL,
 reason TEXT NOT NULL, action TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE change_journal (
 id INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,request_id TEXT NOT NULL,
 actor TEXT NOT NULL,actor_name TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,
 case_id TEXT,operation TEXT NOT NULL,reason TEXT NOT NULL,before_data TEXT,after_data TEXT,created_at TEXT NOT NULL
);
CREATE INDEX journal_owner_id ON change_journal(owner,id);
CREATE TABLE journal_signatures (event_id INTEGER PRIMARY KEY REFERENCES change_journal(id),owner TEXT NOT NULL,previous TEXT NOT NULL,signature TEXT NOT NULL);
CREATE TRIGGER journal_no_update BEFORE UPDATE ON change_journal BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END;
CREATE TRIGGER journal_no_delete BEFORE DELETE ON change_journal BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END;
CREATE TRIGGER signature_no_update BEFORE UPDATE ON journal_signatures BEGIN SELECT RAISE(ABORT,'Signature is append-only'); END;
CREATE TRIGGER signature_no_delete BEFORE DELETE ON journal_signatures BEGIN SELECT RAISE(ABORT,'Signature is append-only'); END;
