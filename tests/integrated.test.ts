import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,differences,signEvent,materialWorkflow,simulate,transitionIssue} from '../lib/sanad/integrated';
import {demoRecord} from '../lib/sanad/demo';
import type {CaseRecord} from '../lib/sanad/types';
const record:CaseRecord={...demoRecord(0),id:'test',reference:'SND-TEST',revision:4,documents:[],status:'ready',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
test('Canonical signatures ignore property order but bind actor, content and chain',async()=>{
 const key='synthetic-test-secret-with-at-least-32-characters';const a={actor:'staff1',data:{b:2,a:1}};
 assert.equal(canonical(a),canonical({data:{a:1,b:2},actor:'staff1'}));
 const signature=await signEvent(key,'GENESIS',a);
 assert.notEqual(signature,await signEvent(key,'GENESIS',{...a,actor:'staff2'}));
 assert.notEqual(signature,await signEvent(key,'other',a));assert.notEqual(signature,await signEvent(key+'x','GENESIS',a));
});
test('Diff preserves old/new values including empty, null, and nested fields',()=>{
 assert.deepEqual(differences({fields:{passportNumber:'A'},note:''},{fields:{passportNumber:'B'},note:null}),[{field:'fields.passportNumber',before:'A',after:'B'},{field:'note',before:'',after:null}]);
 assert.deepEqual(differences({a:1},{a:1}),[]);
});
test('Material changes invalidate approval even after closure',()=>{
 const w=materialWorkflow(record,{stage:'closed',approvedRevision:3});assert.equal(w.needsReview,true);
 assert.equal(materialWorkflow(record,{stage:'ready',approvedRevision:4}).needsReview,false);
 assert.match(transitionIssue(record,{...w,stage:'ready'},'closed','reviewer')!,/النسخة الحالية/);
 assert.match(transitionIssue(record,w,'ready','officer')!,/صلاحية/);
 assert.match(transitionIssue({...record,status:'needs_document'},w,'ready','reviewer')!,/الوثائق/);
});
test('Capacity simulation separates external and missing-document waits from internal work',()=>{
 const review=materialWorkflow(record,{stage:'review'});const external=materialWorkflow(record,{stage:'external_wait'});const missing=materialWorkflow(record,{stage:'intake'});
 const input={reviewers:1,additional:1,minutesPerCase:30,productiveHours:6,arrivalsPerDay:15,horizonDays:7};
 const sim=simulate([review,external,missing],input);assert.equal(sim.internal,1);assert.equal(sim.external,1);assert.equal(sim.missing,1);
 assert.equal(sim.baseline.capacityPerDay,12);assert.equal(sim.proposed.capacityPerDay,24);assert.equal(sim.baseline.clearanceDays,null);assert.equal(sim.proposed.clearanceDays,1);
 assert.equal(sim.baseline.points[7].backlog,22);assert.equal(sim.proposed.points[7].backlog,0);
 const zero=simulate([review],{...input,additional:0});assert.deepEqual(zero.baseline,zero.proposed);
 assert.throws(()=>simulate([],{...input,minutesPerCase:0}));assert.throws(()=>simulate([],{...input,additional:-1}));
});
