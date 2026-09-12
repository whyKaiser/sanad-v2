"use client";
import { useState } from "react";
import { Pencil, Loader2, UserRound, BookOpen, Ticket, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { CaseRecord } from "@/lib/sanad/types";
import { calendarLabels, coreGroups, displayRecordedDate, emptyDetails, profileGroups, type RecordedDate, type TravelerProfile } from "@/lib/sanad/traveler";
import { api } from "./workspace";

export function DateField({ label, value, onChange }: { label: string; value: RecordedDate; onChange: (date: RecordedDate) => void }) {
  return <div className="field"><Label>{label}</Label><div className="recorded-date-input"><Input aria-label={label} dir="ltr" value={value.value} onChange={e => onChange({ ...value, value: e.target.value })} placeholder="YYYY-MM-DD" maxLength={10}/><select aria-label={`تقويم ${label}`} value={value.calendar} onChange={e => onChange({ ...value, calendar: e.target.value as RecordedDate["calendar"] })}>{Object.entries(calendarLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div></div>;
}
export function RecordedValue({ value }: { value: string }) { return /^\d{4}-\d{2}-\d{2}/.test(value) ? <><bdi dir="ltr">{value.slice(0, 10)}</bdi>{value.slice(10)}</> : <>{value || "غير مدخل"}</>; }
export function InfoGrid({ rows }: { rows: string[][] }) { return <dl className="traveler-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto" className={!value ? "unfilled" : ""}><RecordedValue value={value}/></dd></div>)}</dl>; }

export default function TravelerPanel({ record, onRefresh }: { record: CaseRecord; onRefresh: () => Promise<void> }) {
  const details = record.details || emptyDetails();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [profile, setProfile] = useState<TravelerProfile>(details.profile), [revision, setRevision] = useState(details.revision);
  const core = coreGroups(record);
  const icons = [UserRound, BookOpen, Ticket, ChevronDown];
  function edit() { setProfile(structuredClone(details.profile)); setRevision(details.revision); setError(""); setOpen(true); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await api(`/api/cases/${record.id}/profile`, { method: "PUT", body: JSON.stringify({ revision, profile }) }); await onRefresh(); setOpen(false); toast.success("حُفظت بيانات المسافر والتأشيرة"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const latest = details.movements.find(m => m.id === details.latestEntryId);
  return <div className="traveler-panel"><div className="traveler-toolbar"><div><h2>معلومات المسافر</h2><p>خانات السجل مع نسخ الوثائق ومصادرها في ملف واحد.</p></div><Button variant="outline" onClick={edit}><Pencil size={16}/>تعديل الخانات</Button></div>
    {profileGroups.map((g, i) => { const Icon = icons[i]; const content = <InfoGrid rows={[...core[i], ...g.fields.map(([k, label]) => [label, details.profile.values[k]]), ...g.dates.map(([k, label]) => [label, details.profile.dates[k].value ? displayRecordedDate(details.profile.dates[k]) : ""])]}/>; return i === 3 ? <details className="traveler-section" key={g.title}><summary><Icon size={18}/>{g.title}<span>عرض التفاصيل</span></summary>{content}</details> : <section className="traveler-section" key={g.title}><h3><Icon size={18}/>{g.title}</h3>{content}</section>; })}
    <section className="traveler-section latest-entry"><h3>تفاصيل الدخول الأخير</h3><p>{latest ? `حدد الموظف حركة ${latest.reference} كآخر دخول.` : "لم تُحدد حركة تفصيلية بعد. أدناه بيانات الدخول الأساسية المتاحة."}</p><InfoGrid rows={latest ? [["التاريخ", displayRecordedDate(latest.entry.date)], ["الوقت", latest.entry.time], ["وسيلة الدخول", latest.entry.transport], ["جهة الدخول", latest.entry.direction], ["الموقع", latest.entry.location], ["رقم المشغّل", latest.entry.operatorNumber]] : [["تاريخ الدخول — ميلادي", record.entryDate], ["الموقع", record.port]]}/></section>
    <p className="traveler-footnote">مصدر الخانات الإضافية: {details.profile.source || "لم يُدخل بعد"}. المدة المتبقية قيمة مسجلة بتاريخ رصدها، ولا تُحسب تلقائيًا.</p>
    <Dialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}><DialogContent className="sanad-dialog traveler-dialog" dir="rtl"><DialogHeader><DialogTitle>تعديل خانات المسافر</DialogTitle><DialogDescription>بيانات وهمية فقط. الاسم ومعرّفات الحالة الأساسية تظهر للمرجع؛ الخانات الإضافية قابلة للتعديل.</DialogDescription></DialogHeader><form onSubmit={save}><div className="profile-form-sections">{profileGroups.map((g, i) => <section key={g.title}><h3>{g.title}</h3>{core[i].length > 0 && <InfoGrid rows={core[i]}/>}<div className="form-grid">{g.fields.map(([k, label]) => <div className="field" key={k}><Label htmlFor={`profile-${k}`}>{label}</Label><Input id={`profile-${k}`} value={profile.values[k]} maxLength={k === "address" ? 500 : 160} onChange={e => setProfile({ ...profile, values: { ...profile.values, [k]: e.target.value } })}/></div>)}{g.dates.map(([k, label]) => <DateField key={k} label={label} value={profile.dates[k]} onChange={value => setProfile({ ...profile, dates: { ...profile.dates, [k]: value } })}/>)}</div></section>)}</div><div className="field"><Label htmlFor="profile-source">مصدر البيانات التجريبية</Label><Input id="profile-source" value={profile.source} required minLength={2} maxLength={160} placeholder="مثال: سجل اصطناعي للعرض" onChange={e => setProfile({ ...profile, source: e.target.value })}/></div><p className="traveler-footnote">الهجري يُحفظ كما أُدخل مع فحص الصيغة وحدود الشهر واليوم؛ لا تحويل تلقائي ولا مطابقة لتقويم أم القرى.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="traveler-form-actions"><Button type="submit" disabled={busy}>{busy && <Loader2 className="spin" size={16}/>}حفظ بيانات المسافر</Button><Button variant="outline" type="button" disabled={busy} onClick={() => setOpen(false)}>إلغاء</Button></div></form></DialogContent></Dialog>
  </div>;
}
