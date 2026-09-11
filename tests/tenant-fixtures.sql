-- Loopback development database only. Fictitious records for owner-isolation tests.
INSERT OR IGNORE INTO cases (id,owner,reference,data,created_at,updated_at) VALUES ('sanad-test-foreign-case','sanad-test-other-user','TEST-FOREIGN','{}','2026-09-11','2026-09-11');
INSERT OR IGNORE INTO documents (id,owner,case_id,object_key,sha256,data,revision,created_at) VALUES ('sanad-test-foreign-doc','sanad-test-other-user','sanad-test-foreign-case','test-no-file','test-foreign-sha','{}',1,'2026-09-11');
INSERT OR IGNORE INTO packet_reviews (id,owner,case_id,snapshot,created_at) VALUES ('sanad-test-foreign-packet','sanad-test-other-user','sanad-test-foreign-case','{}','2026-09-11');
