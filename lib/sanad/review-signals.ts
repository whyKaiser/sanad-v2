import type {CaseRecord} from './types';
import {discrepancies} from './domain';
export type ReviewSignal={id:string;kind:'document_difference'|'shared_document'|'frequent_changes';title:string;detail:string;caseIds:string[]};
export function reviewSignals(records:CaseRecord[],events:{actor:string;actorId?:string;caseId:string|null;createdAt:string;operation:string}[],now=Date.now()):ReviewSignal[]{
 const signals:ReviewSignal[]=[];
 for(const c of records)for(const d of c.documents){const fields=discrepancies(c,d);if(fields.length)signals.push({id:`difference:${d.id}`,kind:'document_difference',title:'اختلاف بين الوثيقة وسجل الدخول',detail:`${c.reference}: ${fields.length} حقول مختلفة؛ راجع المصدر وملاحظة الموظف.`,caseIds:[c.id]});}
 const byHash=new Map<string,Set<string>>();
 for(const c of records)for(const d of c.documents){const ids=byHash.get(d.sha256)||new Set<string>();ids.add(c.id);byHash.set(d.sha256,ids);}
 for(const [hash,ids]of byHash)if(ids.size>1)signals.push({id:`shared:${hash}`,kind:'shared_document',title:'نفس الملف محفوظ في أكثر من حالة',detail:'تطابق SHA-256 يعني تطابق الملف. قد يكون إعادة استخدام مشروعة؛ راجع ربط الحالات دون افتراض انتحال.',caseIds:[...ids]});
 const counts=new Map<string,{count:number;actor:string;ids:Set<string>}>();
 for(const event of events)if(event.operation==='UPDATE'&&now-Date.parse(event.createdAt)>=0&&now-Date.parse(event.createdAt)<=3600000){const key=event.actorId||event.actor;const value=counts.get(key)||{count:0,actor:event.actor,ids:new Set<string>()};value.count++;if(event.caseId)value.ids.add(event.caseId);counts.set(key,value);}
 for(const [id,value]of counts)if(value.count>=10)signals.push({id:`frequent:${id}`,kind:'frequent_changes',title:'حجم تعديلات يستحق المراجعة',detail:`${value.actor}: ${value.count} تعديلات خلال الساعة. حد تجريبي = 10؛ قد يعكس ضغط عمل طبيعيًا.`,caseIds:[...value.ids]});
 return signals;
}
