"use client";
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
let requestReason:(()=>Promise<string>)|null=null;
export function askChangeReason(){if(!requestReason)return Promise.reject(new Error('شاشة توثيق التعديل غير جاهزة. حدّث الصفحة.'));return requestReason();}
export default function ChangeReason(){
 const [open,setOpen]=useState(false);const [value,setValue]=useState('');const pending=useRef<{resolve:(v:string)=>void;reject:(e:Error)=>void}|null>(null);
 function cancel(){pending.current?.reject(new Error('أُلغي التعديل ولم يُحفظ.'));pending.current=null;setOpen(false);}
 useEffect(()=>{requestReason=()=>new Promise((resolve,reject)=>{if(pending.current){reject(new Error('أكمل سبب التعديل الجاري أولًا.'));return;}pending.current={resolve,reject};setValue('');setOpen(true);});return()=>{requestReason=null;pending.current?.reject(new Error('أُغلقت شاشة التعديل.'));};},[]);
 return <Dialog open={open} onOpenChange={v=>{if(!v)cancel();}}><DialogContent dir="rtl" className="sanad-dialog"><DialogHeader><DialogTitle>سبب التعديل</DialogTitle><DialogDescription>سَنَد يوثّق اسمك والخانات قبل وبعد. اكتب سببًا يساعد زميلك يفهم التغيير.</DialogDescription></DialogHeader><Textarea aria-label="سبب التعديل" value={value} onChange={e=>setValue(e.target.value)} maxLength={500} placeholder="مثال: تصحيح رقم الوثيقة بعد مراجعة النسخة المحفوظة"/><div className="v2-actions"><Button disabled={value.trim().length<8} onClick={()=>{pending.current?.resolve(value.trim());pending.current=null;setOpen(false);}}>توثيق السبب وحفظ التعديل</Button><Button variant="outline" onClick={cancel}>إلغاء</Button></div></DialogContent></Dialog>;
}
