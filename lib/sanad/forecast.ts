import {z} from 'zod';
import rawModel from './forecast-assets/model.json';
import rawHistory from './forecast-assets/history.json';

type Node = [number,number,number,number|null,number,number,number];
type Site = {id:string;airport:string;terminal:string;rows:number;days:number;first:string;last:string;available:boolean;reason:string|null;history:[string,number][]};
const model = rawModel as unknown as {
  metadata:typeof rawModel.metadata;siteIds:string[];
  baseline:{global:number;site:Record<string,number>;hour:Record<string,number>};
  model:{base:number;trees:Node[][]}|null;
};
const sites = rawHistory.sites as Site[];
const HOUR=3600000;
const localPattern=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:00$/;
export class ForecastError extends Error {constructor(public status:number,message:string){super(message);}}
// UTC is only an arithmetic container for the source's local wall-clock strings.
// We never convert these hours to Saudi time or claim a universal UTC timestamp.
export function localHour(value:string):number {
  if(!localPattern.test(value))throw new ForecastError(400,'أدخل التاريخ والساعة بصيغة صحيحة، دون دقائق.');
  const time=Date.parse(value.replace(' ','T')+':00Z');
  if(!Number.isFinite(time)||formatHour(time)!==value.replace('T',' '))throw new ForecastError(400,'التاريخ أو الساعة غير صالحين.');
  return time;
}
export function formatHour(time:number){return new Date(time).toISOString().slice(0,16).replace('T',' ');}
function median(values:number[]):number {if(!values.length)return NaN;const sorted=[...values].sort((a,b)=>a-b);const mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;}
function mean(values:number[]){return values.length?values.reduce((a,b)=>a+b,0)/values.length:NaN;}
function finite(value:number){return Number.isFinite(value);}
const historyMaps=new Map<string,Map<number,number>>();
function historyFor(site:Site){let history=historyMaps.get(site.id);if(!history){history=new Map(site.history.map(([time,count])=>[localHour(time),count]));historyMaps.set(site.id,history);}return history;}

export function forecastFeatures(siteId:string,time:number,asOf:number,history:Map<number,number>):number[]{
  const date=new Date(time),hour=date.getUTCHours(),dow=(date.getUTCDay()+6)%7;
  const known=(lag:number)=>{const stamp=time-lag*HOUR;return stamp<=asOf?(history.get(stamp)??NaN):NaN;};
  const daily=Array.from({length:28},(_,i)=>known((i+1)*24));
  const seen=daily.filter(finite),weekly=[7,14,21,28].map(day=>daily[day-1]).filter(finite);
  return [hour,dow,Number(dow>=5),Math.sin(2*Math.PI*hour/24),Math.cos(2*Math.PI*hour/24),
    Math.sin(2*Math.PI*dow/7),Math.cos(2*Math.PI*dow/7),known(24),known(48),known(168),
    median(seen),median(weekly),mean(daily.slice(0,7).filter(finite)),seen.length,weekly.length,
    ...model.siteIds.map(id=>Number(id===siteId))];
}
export function predictFeatures(siteId:string,features:number[]):number {
  const baseline=model.baseline.hour[`${siteId}|${features[0]}`]??model.baseline.site[siteId]??model.baseline.global;
  const historical=finite(features[10])?features[10]:baseline;
  const weekly=finite(features[11])?features[11]:historical;
  const selected=model.metadata.selected;
  if(selected==='calendar_baseline')return baseline;
  if(selected==='recent_same_hour')return historical;
  if(selected==='weekly_recent_blend')return .4*weekly+.6*historical;
  if(!model.model)throw new ForecastError(503,'نموذج التنبؤ غير متاح.');
  let value=model.model.base;
  for(const tree of model.model.trees){
    let index=0;
    for(let depth=0;depth<=32;depth++){
      const node=tree[index];
      if(!node)throw new ForecastError(503,'تعذر قراءة نموذج التنبؤ.');
      if(node[0]){value+=node[1];break;}
      const input=features[node[2]];
      index=!finite(input)?(node[6]?node[4]:node[5]):input<=(node[3]??Infinity)?node[4]:node[5];
    }
  }
  value=Math.max(0,value);
  return selected.endsWith('_blend')?.75*value+.25*historical:value;
}
export function forecastCatalog(){
  return {metadata:model.metadata,sites:sites.map(({history,...site})=>{void history;return site;}),
    scope:'بيانات أمريكية عامة ومجمعة. الهدف عدد القادمين غير الأمريكيين لكل مطار وصالة وساعة. لا تمثل حالات إدارة الوافدين أو كل منافذ المملكة.',
    timeNote:'كل الأوقات بالتوقيت المحلي للمطار كما نشرها المصدر؛ ليست بتوقيت السعودية.',
    minimumIssueAt:formatHour(localHour(model.metadata.testStart+' 00:00')-HOUR)};
}
export const forecastSchema=z.object({siteId:z.string().min(1).max(160),asOf:z.string().optional(),horizon:z.number().int().min(1).max(24).default(24)}).strict();
export type ForecastInput=z.input<typeof forecastSchema>;
export type ForecastRow={time:string;arrivals:number;lower:number;upper:number;level:'low'|'normal'|'high';observed:number|null;historicalMatches:number};
export function createForecast(input:unknown){
  const data=forecastSchema.parse(input);
  const site=sites.find(site=>site.id===data.siteId);
  if(!site)throw new ForecastError(404,'المطار أو الصالة غير موجودين في مجموعة البيانات.');
  if(!site.available)throw new ForecastError(422,'التغطية المتاحة لهذه الصالة لا تكفي: يلزم 48 قراءة و7 أيام مرصودة على الأقل.');
  const asOf=localHour(data.asOf??site.last),last=localHour(site.last);
  if(asOf>last)throw new ForecastError(422,'لا توجد بيانات أحدث لهذا التاريخ. اختر تاريخًا ضمن التغطية أو استخدم آخر بيانات متاحة.');
  if(asOf<localHour(forecastCatalog().minimumIssueAt))throw new ForecastError(422,'اختر تاريخًا بعد نهاية تدريب النموذج لعرض توقع تاريخي مستقل.');
  const full=historyFor(site),known=[...full].filter(([t])=>t<=asOf);
  const days=new Set(known.map(([t])=>Math.floor(t/(24*HOUR))));
  if(known.length<48||days.size<7)throw new ForecastError(422,'لا يتوفر تاريخ كافٍ قبل وقت إصدار التوقع المختار.');
  const lastKnown=Math.max(...known.map(([t])=>t));
  if(asOf-lastKnown>48*HOUR)throw new ForecastError(422,'توجد فجوة تتجاوز 48 ساعة قبل هذا التوقع. اختر وقتًا أقرب لقراءة متاحة.');
  const counts=known.map(([,v])=>v).sort((a,b)=>a-b);
  const q=(p:number)=>counts[Math.min(counts.length-1,Math.floor(p*(counts.length-1)))];
  const rows:ForecastRow[]=[];
  for(let i=1;i<=data.horizon;i++){
    const time=asOf+i*HOUR,features=forecastFeatures(site.id,time,asOf,full);
    const prediction=predictFeatures(site.id,features),arrivals=Math.max(0,Math.round(prediction));
    const band=model.metadata.validationErrorBand80;
    rows.push({time:formatHour(time),arrivals,lower:Math.max(0,Math.floor(prediction-band)),upper:Math.ceil(prediction+band),
      level:arrivals>q(.9)?'high':arrivals<q(.25)?'low':'normal',observed:full.get(time)??null,historicalMatches:features[13]});
  }
  const peak=rows.reduce((a,b)=>b.arrivals>a.arrivals?b:a);
  const observed=rows.filter(row=>row.observed!==null);
  const coverage=known.length/((asOf-localHour(site.first))/HOUR+1);
  return {mode:'historical_demo' as const,site:{id:site.id,airport:site.airport,terminal:site.terminal},
    asOf:formatHour(asOf),lastObservation:formatHour(lastKnown),horizon:data.horizon,rows,peak,
    total:rows.reduce((total,row)=>total+row.arrivals,0),knownHours:known.length,coverage:Math.min(1,coverage),
    observedHours:observed.length,replayMae:observed.length?observed.reduce((sum,row)=>sum+Math.abs(row.arrivals-row.observed!),0)/observed.length:null,
    lowHistoryHours:rows.filter(row=>row.historicalMatches<3).length,
    intervalNote:'نطاق إرشادي من أخطاء فترة التحقق، وليس ضمانًا لكل ساعة. القيم الناقصة ليست صفرًا.',
    source:model.metadata.source,modelVersion:model.metadata.version};
}
export type ForecastResult=ReturnType<typeof createForecast>;
export type ForecastCatalog=ReturnType<typeof forecastCatalog>;
export const capacitySchema=z.object({booths:z.number().int().min(1).max(100),additional:z.number().int().min(0).max(100),
  minutesPerPassenger:z.number().min(.25).max(60),initialQueue:z.number().int().min(0).max(10000)}).strict();
export type CapacityInput=z.infer<typeof capacitySchema>;
export function passengerSimulation(forecast:ForecastResult,input:unknown){
  const values=capacitySchema.parse(input);
  function scenario(booths:number){
    const capacity=booths*60/values.minutesPerPassenger;
    let queue=values.initialQueue;
    const points=forecast.rows.map(row=>{queue=Math.max(0,queue+row.arrivals-capacity);return {time:row.time,queue:Math.round(queue*100)/100,wait:Math.round(queue/capacity*60*10)/10};});
    return {capacityPerHour:capacity,points,lastQueue:points.at(-1)!.queue,maxQueue:Math.max(...points.map(p=>p.queue))};
  }
  return {kind:'assumption_simulation' as const,inputs:values,baseline:scenario(values.booths),proposed:scenario(values.booths+values.additional),
    scope:'محاكاة حسابية لكاونترات مخصصة لفئة القادمين التي يتوقعها النموذج. الكاونترات وسرعة الخدمة والطابور افتراضات وليست بيانات تشغيل سعودية. الانتظار تقدير تقريبي من المتراكم والسعة، لا قياس ميداني. لا تنفيذ تلقائي.'};
}
export type PassengerSimulation=ReturnType<typeof passengerSimulation>;
export function forecastCsv(result:ForecastResult){
  const escape=(value:string|number|null)=>'"'+String(value??'').replaceAll('"','""')+'"';
  const header=['airport','terminal','as_of_local','time_local','predicted_non_us_passengers','lower','upper','observed_if_available','volume_level','mode'];
  return '\ufeff'+[header,...result.rows.map(row=>[result.site.airport,result.site.terminal,result.asOf,row.time,row.arrivals,row.lower,row.upper,row.observed,row.level,result.mode])].map(row=>row.map(escape).join(',')).join('\r\n');
}
