"use client";
import { useEffect, useState } from "react";
import { api, formatDate } from "./workspace";
export default function PacketHistory({caseId}:{caseId:string}){
  const [rows,setRows]=useState<{id:string;createdAt:string}[]>([]);
  const [error,setError]=useState("");
  useEffect(()=>{let cancelled=false;api<typeof rows>(`/api/packet/${caseId}/history`).then(data=>{if(!cancelled)setRows(data);}).catch(()=>{if(!cancelled)setError("تعذر تحميل الحزم السابقة.");});return()=>{cancelled=true;};},[caseId]);
  if(error)return <p className="form-error">{error}</p>;
  if(!rows.length)return null;
  return <div className="packet-history"><h3>الحزم المحفوظة بعد المراجعة</h3>{rows.map((row,i)=><a key={row.id} href={`/api/packet-snapshots/${row.id}`} target="_blank" rel="noreferrer">فتح النسخة {rows.length-i} · {formatDate(row.createdAt)} · {new Date(row.createdAt).toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"})}</a>)}</div>;
}
