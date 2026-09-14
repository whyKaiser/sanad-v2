import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CaseDetail from '../components/sanad/case-detail';
import TravelerPanel from '../components/sanad/traveler-panel';
import TravelHistory from '../components/sanad/travel-history';
import Directives from '../components/sanad/directives';
import PreArrival from '../components/sanad/pre-arrival';
import {demoRecord} from '../lib/sanad/demo';
import type {CaseRecord,StoredDocument} from '../lib/sanad/types';
const record={...demoRecord(0),id:'synthetic-ui',reference:'UI-TEST',revision:1,documents:[],status:'needs_document',createdAt:'2026-09-14',updatedAt:'2026-09-14'} as CaseRecord;
const props={record,onRefresh:async()=>{},onDocument:()=>{}};

test('Read-only role sees document access but no mutating actions across traveler panels',()=>{
 const traveler=renderToStaticMarkup(<TravelerPanel {...props} role="viewer"/>);
 const travel=renderToStaticMarkup(<TravelHistory {...props} role="viewer"/>);
 const directives=renderToStaticMarkup(<Directives {...props} role="viewer"/>);
 const intake=renderToStaticMarkup(<PreArrival role="viewer" onOpenCase={()=>{}} onRefresh={props.onRefresh}/>);
 for(const [html,label] of [[traveler,'تعديل الخانات'],[travel,'إضافة حركة'],[travel,'إضافة أول حركة'],[directives,'إضافة مرجع تجريبي'],[intake,'طلب تجريبي جديد']])assert.ok(!html.includes(label),label);
 assert.ok(traveler.includes('معلومات المسافر'));
 assert.ok(renderToStaticMarkup(<TravelerPanel {...props} role="officer"/>).includes('تعديل الخانات'));
 assert.ok(renderToStaticMarkup(<TravelHistory {...props} role="officer"/>).includes('إضافة حركة'));
});

test('Document review controls match reviewer, officer, and viewer capabilities',()=>{
 const doc={id:'synthetic-doc',type:'passport',revision:1,contentType:'image/png',filename:'synthetic.png',source:'مصدر اصطناعي',capturedAt:'2026-09-14',fields:{name:'OMAR SALIM',passportNumber:'SND000101',nationality:'UTO',birthDate:'1990-04-12',expiryDate:'2030-04-12'},locations:{},reviewStatus:'pending',reviewNote:'',synthetic:true} as StoredDocument;
 const render=(role:'viewer'|'officer'|'reviewer')=>renderToStaticMarkup(<CaseDetail {...props} record={{...record,documents:[doc]}} role={role} audit={[]} onBack={()=>{}} onUpload={()=>{}}/>);
 const viewer=render('viewer');assert.ok(!viewer.includes('إرفاق وثيقة'));assert.ok(!viewer.includes('حفظ كمسودة'));assert.ok(viewer.includes('readOnly=""'));assert.ok(viewer.includes('فتح المستند الأصلي'));
 const officer=render('officer');assert.ok(officer.includes('حفظ كمسودة'));assert.ok(!officer.includes('اعتماد مراجعة البيانات'));
 assert.ok(render('reviewer').includes('اعتماد مراجعة البيانات'));
});
