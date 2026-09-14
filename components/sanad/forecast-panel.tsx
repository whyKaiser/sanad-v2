"use client";
import {useEffect,useState} from 'react';
import {Activity,AlertTriangle,ChartNoAxesCombined,Download,Loader2,PlaneLanding} from 'lucide-react';
import {Area,AreaChart,CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {api} from './workspace';
import type {CapacityInput,ForecastCatalog,ForecastResult,PassengerSimulation} from '@/lib/sanad/forecast';
import {toast} from 'sonner';

const levelLabels={low:'إقبال أقل',normal:'إقبال معتاد',high:'إقبال مرتفع'};
const count=(value:number)=>new Intl.NumberFormat('ar-SA',{maximumFractionDigits:1}).format(value);
export default function ForecastPanel(){
  const [catalog,setCatalog]=useState<ForecastCatalog|null>(null);
  const [siteId,setSiteId]=useState('');
  const [asOf,setAsOf]=useState('');
  const [result,setResult]=useState<ForecastResult|null>(null);
  const [simulation,setSimulation]=useState<PassengerSimulation|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [capacity,setCapacity]=useState<CapacityInput>({booths:4,additional:2,minutesPerPassenger:2,initialQueue:0});
  useEffect(()=>{let active=true;api<ForecastCatalog>('/api/forecast/sites').then(data=>{
    if(active){setCatalog(data);const site=data.sites.find(s=>s.id==='JFK|Terminal 4 (IAT)')??data.sites.find(s=>s.available);
      if(site){setSiteId(site.id);setAsOf(site.last.replace(' ','T'));}}
  }).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[]);
  const site=catalog?.sites.find(s=>s.id===siteId);
  function selectSite(id:string){setSiteId(id);const selected=catalog?.sites.find(s=>s.id===id);setAsOf(selected?.last.replace(' ','T')??'');setResult(null);setSimulation(null);setError('');}
  async function run(){setBusy(true);setError('');setResult(null);setSimulation(null);try{
    setResult(await api<ForecastResult>('/api/forecast',{method:'POST',body:JSON.stringify({siteId,asOf,horizon:24})}));
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function compare(){if(!result)return;setBusy(true);setSimulation(null);try{
    setSimulation(await api<PassengerSimulation>('/api/forecast/simulation',{method:'POST',body:JSON.stringify({forecast:{siteId:result.site.id,asOf:result.asOf,horizon:result.horizon},capacity})}));
  }catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  async function download(){if(!result)return;setBusy(true);try{
    const response=await fetch('/api/forecast/csv',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId:result.site.id,asOf:result.asOf,horizon:result.horizon})});
    if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error||'تعذر تصدير التوقع.');}
    const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='sanad-historical-forecast.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  if(!catalog)return <section className="v2-card">{error?<p role="alert">{error}<Button variant="outline" onClick={()=>window.location.reload()}>إعادة التحميل</Button></p>:<p role="status"><Loader2 className="spin"/> تحميل بيانات التنبؤ…</p>}</section>;
  const info=catalog.metadata;
  const chart=result?.rows.map(row=>({...row,hour:row.time.slice(11),range:[row.lower,row.upper]}));
  const compareChart=simulation?.baseline.points.map((point,index)=>({hour:point.time.slice(11),before:point.queue,after:simulation.proposed.points[index].queue}));
  return <div className="v2-stack forecast-panel">
    <div className="page-heading"><div><div className="eyebrow">التخطيط قبل تزايد الحركة</div><h1>توقع الإقبال في المنافذ</h1><p>توقع 24 ساعة، مقارنة تاريخية، ومحاكاة أثر الطاقة المتاحة.</p></div><PlaneLanding size={40}/></div>
    <div className="v2-notice"><AlertTriangle/><div><strong>تجربة على بيانات تاريخية أمريكية</strong><p>{catalog.scope}</p><p>{catalog.timeNote} آخر بيانات المجموعة: <bdi>{info.lastObservation}</bdi>.</p></div></div>
    <section className="v2-card"><h2>اختر المطار والصالة ووقت إصدار التوقع</h2><div className="v2-form-grid">
      <label>المطار والصالة<select aria-label="المطار والصالة" value={siteId} onChange={e=>selectSite(e.target.value)}>{catalog.sites.map(s=><option key={s.id} value={s.id}>{s.airport} · {s.terminal}{s.available?'':' — تغطية غير كافية'}</option>)}</select></label>
      <label>إصدار التوقع بعد هذه الساعة<Input aria-label="تاريخ إصدار التوقع" type="datetime-local" step={3600} value={asOf} min={catalog.minimumIssueAt.replace(' ','T')} max={site?.last.replace(' ','T')} onChange={e=>{setAsOf(e.target.value);setResult(null);setSimulation(null);}}/></label>
    </div>{site&&<p className="v2-muted">{count(site.rows)} ساعة مرصودة خلال {count(site.days)} يومًا · من <bdi>{site.first}</bdi> إلى <bdi>{site.last}</bdi>. الساعات غير المنشورة لا تعني صفر مسافرين.</p>}
      {!site?.available&&<p role="status" className="forecast-warning">تغطية هذه الصالة غير كافية لتوقع موثوق. اختر صالة أخرى؛ لا تُولّد أرقامًا بدل البيانات الناقصة.</p>}
      <div className="v2-actions"><Button onClick={run} disabled={busy||!site?.available||!asOf}>{busy?<Loader2 className="spin"/>:<ChartNoAxesCombined size={17}/>}اعرض توقع 24 ساعة</Button><Button variant="outline" disabled={!site} onClick={()=>{setAsOf(site!.last.replace(' ','T'));setResult(null);setSimulation(null);setError('');}}>آخر تاريخ متاح</Button></div>
      {error&&<p role="alert" className="forecast-warning">{error}</p>}
    </section>
    {result&&<>
      <section className="v2-card"><div className="v2-section-heading"><div><h2>الإقبال المتوقع</h2><p>من <bdi>{result.rows[0].time}</bdi> إلى <bdi>{result.rows.at(-1)!.time}</bdi> · توقع تاريخي، وليس بثًا مباشرًا.</p></div><Button variant="outline" onClick={download} disabled={busy}><Download size={16}/>تنزيل النتائج CSV</Button></div>
        <div className="forecast-stats"><div><span>إجمالي القادمين المتوقع</span><strong>{count(result.total)}</strong><small>غير أمريكيين في بيانات المصدر</small></div><div><span>ساعة أعلى إقبال متوقع</span><strong dir="ltr">{result.peak.time.slice(11)}</strong><small>{count(result.peak.arrivals)} مسافرًا متوقعًا</small></div><div><span>الساعات المرصودة في التاريخ</span><strong>{count(result.coverage*100)}%</strong><small>نسبة التغطية؛ ليست دقة النموذج</small></div><div><span>آخر قراءة قبل التوقع</span><strong className="forecast-small" dir="ltr">{result.lastObservation}</strong><small>المعرفة المتاحة وقت إصدار التوقع</small></div></div>
        <div className="forecast-chart" dir="ltr"><ResponsiveContainer width="100%" height={300}><LineChart data={chart}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="hour"/><YAxis allowDecimals={false}/><Tooltip/><Line type="linear" dataKey="arrivals" name="القادمون المتوقعون" stroke="#10756b" strokeWidth={2} dot={false}/><Line type="linear" dataKey="observed" name="القادمون المرصودون إن توفروا" stroke="#b7833d" strokeDasharray="5 3" dot={false} connectNulls={false}/></LineChart></ResponsiveContainer></div>
        <p className="v2-muted">الأفقي: الساعة المحلية للمطار · الرأسي: عدد القادمين. المرصود يظهر للمقارنة بعد التوقع، ولا يدخل في حسابه.</p>
        {result.observedHours>0?<p>تتوفر مقارنة فعلية لـ{count(result.observedHours)} ساعة من {result.horizon}؛ متوسط الخطأ في هذه المقارنة {count(result.replayMae!)} مسافرًا.</p>:<p>لا توجد أعداد فعلية للفترة التالية في هذه النسخة من البيانات، لذلك لا يمكن قياس صحة هذه التوقعات بعد.</p>}
        {result.lowHistoryHours>0&&<p className="forecast-warning">{count(result.lowHistoryHours)} ساعات لها أقل من 3 قراءات في الساعة نفسها خلال الأسابيع السابقة؛ تعامل مع نتائجها بحذر.</p>}
        <details className="forecast-details"><summary>تفاصيل كل ساعة ونطاق التوقع</summary><p>{result.intervalNote}</p><div className="forecast-table"><table><thead><tr><th>التاريخ والساعة</th><th>المتوقع</th><th>النطاق الإرشادي</th><th>المرصود</th><th>مستوى الإقبال</th></tr></thead><tbody>{result.rows.map(row=><tr key={row.time}><td dir="ltr">{row.time}</td><td>{count(row.arrivals)}</td><td>{count(row.lower)} – {count(row.upper)}</td><td>{row.observed===null?'غير متاح':count(row.observed)}</td><td>{levelLabels[row.level]}</td></tr>)}</tbody></table></div></details>
      </section>
      <section className="v2-card"><h2>جرّب أثر زيادة الكاونترات</h2><p>افترض كاونترات مخصصة لفئة القادمين المتوقعة، ثم قارن المتراكم. هذه محاكاة حسابية؛ الأرقام التشغيلية أدناه تدخلها أنت.</p>
        <div className="v2-form-grid">{Object.entries({booths:'الكاونترات الحالية',additional:'كاونترات إضافية',minutesPerPassenger:'دقائق خدمة المسافر',initialQueue:'مسافرون ينتظرون عند البداية'}).map(([key,label])=><label key={key}>{label}<Input aria-label={label} type="number" min={key==='minutesPerPassenger'?.25:key==='booths'?1:0} max={key==='minutesPerPassenger'?60:key==='initialQueue'?10000:100} step={key==='minutesPerPassenger'?.25:1} value={capacity[key as keyof CapacityInput]} onChange={e=>{setCapacity({...capacity,[key]:Number(e.target.value)});setSimulation(null);}}/></label>)}</div>
        <Button onClick={compare} disabled={busy}>{busy?<Loader2 className="spin"/>:<Activity size={17}/>}قارن الطاقة الحالية والمقترحة</Button>
        {simulation&&<div className="v2-simulation"><div className="v2-compare"><div><span>السعة الحالية / ساعة</span><strong>{count(simulation.baseline.capacityPerHour)}</strong><p>المتبقي في النهاية: {count(simulation.baseline.lastQueue)} مسافرًا</p></div><div><span>السعة بعد الإضافة / ساعة</span><strong>{count(simulation.proposed.capacityPerHour)}</strong><p>المتبقي في النهاية: {count(simulation.proposed.lastQueue)} مسافرًا</p></div></div><div className="forecast-chart" dir="ltr"><ResponsiveContainer width="100%" height={250}><AreaChart data={compareChart}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="hour"/><YAxis/><Tooltip/><Area type="linear" dataKey="before" name="المتراكم الحالي" stroke="#b7833d" fill="#b7833d" fillOpacity={.1}/><Area type="linear" dataKey="after" name="المتراكم بعد الإضافة" stroke="#10756b" fill="#10756b" fillOpacity={.1}/></AreaChart></ResponsiveContainer></div><p className="v2-muted">الأفقي: الساعة · الرأسي: المسافرون المتراكمون بنهاية الساعة.</p><p>السعة = الكاونترات × 60 ÷ دقائق الخدمة. المتراكم التالي = المتراكم الحالي + القادمين − السعة، بحد أدنى صفر.</p><div className="v2-notice"><AlertTriangle/><p>{simulation.scope}</p></div></div>}
      </section>
    </>}
    <section className="v2-card"><h2>كيف اختُبر النموذج؟</h2><p>اختير النموذج باستخدام فترة تحقق مستقلة، ثم اختُبر على تواريخ لاحقة. المدخلات التاريخية تسبق ساعة التوقع بـ24 ساعة أو أكثر، لذلك لا يحتاج إلى معرفة الأعداد الفعلية للساعات القادمة.</p>
      <div className="forecast-stats"><div><span>متوسط خطأ النموذج</span><strong>{count(info.test.mae)}</strong><small>مسافر / ساعة مرصودة</small></div><div><span>متوسط خطأ التوقع البسيط</span><strong>{count(info.baseline.mae)}</strong><small>لنفس عينات الاختبار</small></div><div><span>انخفاض متوسط الخطأ</span><strong>{count(info.improvementPercent)}%</strong><small>مقارنة بالتوقع البسيط، وليس نسبة دقة</small></div><div><span>ساعات الاختبار</span><strong>{count(info.test.rows)}</strong><small>من {info.testStart} إلى {info.testEnd.slice(0,10)}</small></div></div>
      <details className="forecast-details"><summary>مصدر البيانات وحدود النتائج</summary><p>نموذج مدرّب مع الاستفادة من القراءات السابقة للساعة نفسها. البيانات من {info.airports} مطارًا أمريكيًا، وعددها {count(info.rawRows)} قراءة. التغطية متفاوتة، وبعض الصالات لا تكفي للتوقع.</p><p>النطاق الإرشادي مبني على أخطاء فترة التحقق؛ احتوى {count(info.testBandCoverage*100)}% من قيم الاختبار. هذه نسبة تغطية تاريخية، وليست ضمانًا لساعة مستقبلية.</p><p>لم يُثبت الأداء على بيانات تشغيل سعودية، ولا على مواسم سنوية كاملة. أوقات نشر القراءات لحظيًا غير متحقق منها. لا يفسر هذا النموذج انتظار القنصلية أو يقرر إجراءً بحق شخص.</p><p><a href={info.source} target="_blank" rel="noreferrer">مجموعة البيانات — Henry Williams، ترخيص CC BY 4.0</a> · <a href={info.upstream} target="_blank" rel="noreferrer">مصدر CBP</a></p><p>نسخة النموذج: <bdi>{info.version}</bdi></p></details>
    </section>
  </div>;
}
