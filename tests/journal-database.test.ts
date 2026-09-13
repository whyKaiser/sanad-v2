import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {reviewSignals} from '../lib/sanad/review-signals';
function setup(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+name,'utf8'));return db;}
test('Journal before/after and trusted actor commit atomically; edits without context and audit deletion fail',()=>{
 const db=setup();const now=Date.now();db.prepare('INSERT INTO mutation_context VALUES (?,?,?,?,?,?,?)').run('tenant-a','request-1','staff-a','موظف اصطناعي','تصحيح من المستند الأصلي','PATCH',now+60000);
 db.prepare('INSERT INTO cases(id,owner,reference,data,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('case-a','tenant-a','SND-TEST','{"notes":"before"}','2026-09-13','2026-09-13');
 db.prepare('UPDATE cases SET data=? WHERE id=?').run('{"notes":"after"}','case-a');
 const row=db.prepare('SELECT * FROM change_journal ORDER BY id DESC LIMIT 1').get()!;
 assert.equal(row.actor,'staff-a');assert.equal(JSON.parse(row.before_data as string).notes,'before');assert.equal(JSON.parse(row.after_data as string).notes,'after');
 assert.equal(db.prepare('SELECT revision FROM cases').get()!.revision,2);
 assert.throws(()=>db.exec("UPDATE change_journal SET actor='forged'"),/append-only/);
 assert.throws(()=>db.exec('DELETE FROM change_journal'),/append-only/);
 db.exec('DELETE FROM mutation_context');assert.throws(()=>db.exec("UPDATE cases SET data='{}'"),/Missing mutation context/);
 assert.equal(JSON.parse(db.prepare('SELECT data FROM cases').get()!.data as string).notes,'after');db.close();
});
test('A failed business transaction rolls its journal back and cannot leak another workspace actor',()=>{
 const db=setup();db.prepare('INSERT INTO mutation_context VALUES (?,?,?,?,?,?,?)').run('a','request','actor-a','موظف','سبب اصطناعي','POST',Date.now()+60000);
 db.exec('BEGIN');try{db.prepare('INSERT INTO cases(id,owner,reference,data,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('a','a','R','{}','2026-09-13','2026-09-13');db.prepare('INSERT INTO cases(id,owner,reference,data,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('b','b','R','{}','2026-09-13','2026-09-13');assert.fail('Other workspace must lack context');}catch{db.exec('ROLLBACK');}
 assert.equal(db.prepare('SELECT count(*) AS n FROM cases').get()!.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM change_journal').get()!.n,0);db.close();
});
test('Repeated-edit signal describes workload, not guilt, and excludes expired activity',()=>{
 const now=Date.now();const events=Array.from({length:10},()=>({actor:'موظف',caseId:'x',createdAt:new Date(now-1000).toISOString(),operation:'UPDATE'}));
 assert.equal(reviewSignals([],events,now).length,1);assert.match(reviewSignals([],events,now)[0].detail,/ضغط عمل طبيعيًا/);assert.equal(reviewSignals([],events,now+3600000).length,0);
});
