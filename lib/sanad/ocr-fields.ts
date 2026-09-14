import { type TravelFields, type FieldLocation, type FieldKey, emptyFields, fieldLabels } from './types';
type Box={x0:number;y0:number;x1:number;y1:number};
type Word={text:string;bbox:Box};
type OcrLine={text:string;bbox:Box;words:Word[]};
export type OcrBlock={paragraphs:{lines:OcrLine[]}[]};
const labels:Record<FieldKey,RegExp>={
  name:/^(?:FULL NAME|NAME|SURNAME)\b/i,
  passportNumber:/^(?:DOCUMENT|PASSPORT)\s*(?:NUMBER|NO\.?)\b/i,
  nationality:/^NATIONALITY\b/i,
  birthDate:/^(?:DATE OF BIRTH|BIRTH DATE|DOB)\b/i,
  expiryDate:/^(?:DATE OF EXPIRY|EXPIRY DATE|EXPIRATION DATE|DATE OF EXPIRATION)\b/i,
};
const keys=Object.keys(labels) as FieldKey[];
const clean=(s:string)=>s.toUpperCase().replace(/：/g,':').replace(/\s+/g,' ').trim();
const isLabel=(s:string)=>keys.some(k=>labels[k].test(clean(s)));
function validDate(year:number,month:number,day:number){
  const date=new Date(Date.UTC(year,month-1,day));
  return year>=1900&&year<=2099&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day
    ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
}
export function parseOcrDate(input:string){
  const value=clean(input);
  const iso=value.match(/\b(19\d{2}|20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\b/);
  if(iso)return validDate(+iso[1],+iso[2],+iso[3]);
  const named=value.match(/\b(\d{1,2})[\s./-]+(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)[\s./-]+(19\d{2}|20\d{2})\b/);
  if(named)return validDate(+named[3],['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(named[2].slice(0,3))+1,+named[1]);
  const numeric=value.match(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(19\d{2}|20\d{2})\b/);
  // Never guess ambiguous day/month order.
  if(numeric){const a=+numeric[1],b=+numeric[2];if(a===b||a>12)return validDate(+numeric[3],b,a);if(b>12)return validDate(+numeric[3],a,b);}
  return '';
}
function fieldValue(key:FieldKey,input:string){
  const text=clean(input).replace(/^[\s:|.]+/,'');if(!text||isLabel(text))return '';
  if(key.endsWith('Date'))return parseOcrDate(text);
  if(key==='passportNumber')return text.match(/^[A-Z0-9]{5,20}\b/)?.[0]||'';
  if(key==='nationality')return /^[A-Z][A-Z '\-]{1,59}$/.test(text)?text:'';
  return /^[A-Z][A-Z '\-]{1,159}$/.test(text)?text:'';
}
export function parseOcrText(text:string):TravelFields{
  const fields=emptyFields(),lines=text.split(/\n/).map(clean).filter(Boolean);
  for(const key of keys){const i=lines.findIndex(line=>labels[key].test(line));if(i<0)continue;
    const inline=lines[i].replace(labels[key],'').replace(/^[\s:|.]+/,''),next=lines[i+1]||'';
    fields[key]=fieldValue(key,inline||(!isLabel(next)?next:''));
  }
  // Unvalidated MRZ text cannot overwrite visible labels or infer date centuries.
  // MRZ-only and unsupported layouts use manual transcription for now.
  return fields;
}
function boxOf(words:Word[]):Box{return {x0:Math.min(...words.map(w=>w.bbox.x0)),x1:Math.max(...words.map(w=>w.bbox.x1)),y0:Math.min(...words.map(w=>w.bbox.y0)),y1:Math.max(...words.map(w=>w.bbox.y1))};}
export function extractLayout(text:string,blocks:OcrBlock[],width:number,height:number){
  const fields=parseOcrText(text),locations:Partial<Record<FieldKey,FieldLocation>>={};
  if(!(width>0&&height>0))return {fields,locations};
  const lines=blocks.flatMap(b=>b.paragraphs.flatMap(p=>p.lines)),allWords=lines.flatMap(l=>l.words);
  const found:{key:FieldKey;box:Box;words:Word[]}[]=[];
  for(const line of lines)for(let start=0;start<line.words.length;start++)for(let length=1;length<=3&&start+length<=line.words.length;length++){
    const words=line.words.slice(start,start+length);
    if(words.some((w,i)=>i>0&&w.bbox.x0-words[i-1].bbox.x1>Math.max(32,(w.bbox.y1-w.bbox.y0)*2)))continue;
    const phrase=clean(words.map(w=>w.text).join(' ')).replace(/[:.]/g,'');
    for(const key of keys)if(labels[key].test(phrase)&&!phrase.replace(labels[key],'').trim())found.push({key,box:boxOf(words),words});
  }
  const anchors=found.filter(a=>!found.some(b=>a!==b&&a.key===b.key&&b.words.length>a.words.length&&a.words.every(w=>b.words.includes(w))));
  const labelWords=new Set(anchors.flatMap(a=>a.words));
  for(const anchor of anchors){
    const box=anchor.box,lineHeight=Math.max(12,box.y1-box.y0);
    const onRow=(b:Box)=>Math.abs((b.y0+b.y1-box.y0-box.y1)/2)<lineHeight*.8;
    const next=anchors.filter(a=>a.box.x0>box.x1&&onRow(a.box)).sort((a,b)=>a.box.x0-b.box.x0)[0],right=next?next.box.x0-5:width;
    const inline=allWords.filter(w=>!labelWords.has(w)&&w.bbox.x0>=box.x1&&w.bbox.x1<=right&&onRow(w.bbox)).sort((a,b)=>a.bbox.x0-b.bbox.x0);
    const belowLabel=anchors.filter(a=>a.box.y0>box.y1&&a.box.x0>=box.x0-8&&a.box.x0<right).sort((a,b)=>a.box.y0-b.box.y0)[0];
    const bottom=Math.min(box.y1+Math.max(80,height*.1),belowLabel?.box.y0??height);
    const below=allWords.filter(w=>!labelWords.has(w)&&w.bbox.x0>=box.x0-8&&w.bbox.x1<=right&&w.bbox.y0>box.y1&&w.bbox.y0<bottom).sort((a,b)=>a.bbox.y0-b.bbox.y0),first=below[0];
    const row=first?below.filter(w=>Math.abs((w.bbox.y0+w.bbox.y1-first.bbox.y0-first.bbox.y1)/2)<Math.max(12,first.bbox.y1-first.bbox.y0)*.8).sort((a,b)=>a.bbox.x0-b.bbox.x0):[];
    for(const words of [inline,row]){if(!words.length)continue;
      const value=fieldValue(anchor.key,words.map(w=>w.text).join(' '));if(!value)continue;
      fields[anchor.key]=value;const bounds=boxOf(words),x=Math.max(0,bounds.x0),y=Math.max(0,bounds.y0);
      locations[anchor.key]={x:x/width,y:y/height,width:Math.max(0,Math.min(width,bounds.x1)-x)/width,height:Math.max(0,Math.min(height,bounds.y1)-y)/height};break;
    }
  }
  return {fields,locations};
}
export function ocrWarnings(fields:TravelFields,confidence:number){
  const missing=keys.filter(k=>!fields[k]),warnings:string[]=[];
  if(missing.length)warnings.push(`لم تُقرأ بثقة: ${missing.map(k=>fieldLabels[k]).join('، ')}. راجع الصورة وأكملها يدويًا؛ التاريخ المحتمل بأكثر من ترتيب يبقى فارغًا.`);
  if(confidence<75)warnings.push('جودة تعرف النص منخفضة؛ جرّب نسخة أوضح وراجع كل حقل. هذه الدرجة لا تقيس صحة الوثيقة.');
  return warnings;
}
