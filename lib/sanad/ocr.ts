import { TravelFields, FieldLocation, FieldKey, emptyFields } from "./types";
export type OcrResult={fields:TravelFields;text:string;confidence:number;locations:Partial<Record<FieldKey,FieldLocation>>};
type Box={x0:number;y0:number;x1:number;y1:number};
type OcrLine={text:string;bbox:Box;words:{text:string;bbox:Box}[]};
type OcrBlock={paragraphs:{lines:OcrLine[]}[]};
function parseDate(s:string){const m=s.match(/(19\d{2}|20\d{2})[-/.](\d{2})[-/.](\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:"";}
export function parseOcrText(text:string):TravelFields {
  const f=emptyFields();const lines=text.toUpperCase().split(/\n/).map(x=>x.trim()).filter(Boolean);
  function after(pattern:RegExp){const i=lines.findIndex(x=>pattern.test(x));if(i<0)return "";const inline=lines[i].replace(pattern,"").replace(/^\s*[:|]\s*/,"").trim();return inline||lines[i+1]||"";}
  f.name=after(/^NAME\b\s*:?/).replace(/[^A-Z\s'-]/g,"").trim();
  f.passportNumber=after(/^(?:DOCUMENT|PASSPORT)\s*(?:NUMBER|NO\.?)[\s:]*/).match(/[A-Z0-9]{5,20}/)?.[0]||"";
  f.nationality=after(/^NATIONALITY\b\s*:?/).match(/[A-Z]{3,30}/)?.[0]||"";
  f.birthDate=parseDate(after(/^(?:DATE OF BIRTH|BIRTH DATE|DOB)\b\s*:?/));
  f.expiryDate=parseDate(after(/^(?:DATE OF EXPIRY|EXPIRY DATE|EXPIRATION DATE)\b\s*:?/));
  const mrz=lines.map(l=>l.replace(/\s/g,"")).filter(l=>l.includes("<")&&l.length>=40);
  const first=mrz.find(l=>/^P[<A-Z]/.test(l));
  if(first){f.name=first.slice(5).replace(/<+/g," ").trim();const i=mrz.indexOf(first);const second=mrz[i+1];if(second?.length>=43){f.passportNumber=second.slice(0,9).replace(/</g,"");f.nationality=second.slice(10,13);const dob=second.slice(13,19),exp=second.slice(21,27);if(/^\d{6}$/.test(dob)){const yy=Number(dob.slice(0,2));const current=new Date().getUTCFullYear()%100;f.birthDate=`${yy>current?"19":"20"}${dob.slice(0,2)}-${dob.slice(2,4)}-${dob.slice(4,6)}`;}if(/^\d{6}$/.test(exp))f.expiryDate=`20${exp.slice(0,2)}-${exp.slice(2,4)}-${exp.slice(4,6)}`;}}
  return f;
}
export function extractLayout(text:string,blocks:OcrBlock[],width:number,height:number){
  const fields=parseOcrText(text);const locations:Partial<Record<FieldKey,FieldLocation>>={};
  const lines=blocks.flatMap(b=>b.paragraphs.flatMap(p=>p.lines));
  const labels:Record<FieldKey,RegExp>={name:/^(NAME|FULL NAME|SURNAME)$/,passportNumber:/^(DOCUMENT NUMBER|PASSPORT NUMBER|PASSPORT NO)$/,nationality:/^NATIONALITY$/,birthDate:/^(DATE OF BIRTH|BIRTH DATE|DOB)$/,expiryDate:/^(DATE OF EXPIRY|EXPIRY DATE|EXPIRATION DATE)$/};
  const anchors:{key:FieldKey;box:Box}[]=[];
  for(const line of lines)for(let start=0;start<line.words.length;start++)for(let length=1;length<=3&&start+length<=line.words.length;length++){
    const words=line.words.slice(start,start+length);
    if(words.some((w,i)=>i>0&&w.bbox.x0-words[i-1].bbox.x1>Math.max(32,(w.bbox.y1-w.bbox.y0)*2)))continue;
    const phrase=words.map(w=>w.text.toUpperCase().replace(/[:.]/g,'')).join(' ');
    for(const key of Object.keys(labels) as FieldKey[])if(labels[key].test(phrase))anchors.push({key,box:{x0:words[0].bbox.x0,y0:Math.min(...words.map(w=>w.bbox.y0)),x1:words.at(-1)!.bbox.x1,y1:Math.max(...words.map(w=>w.bbox.y1))}});
  }
  for(const anchor of anchors){
    const next=anchors.filter(a=>a.box.x0>anchor.box.x1&&Math.abs(a.box.y0-anchor.box.y0)<20).sort((a,b)=>a.box.x0-b.box.x0)[0];
    const right=next?next.box.x0-10:width;
    const candidates=lines.flatMap(line=>{const words=line.words.filter(w=>w.bbox.x0>=anchor.box.x0-8&&w.bbox.x0<right&&w.bbox.y0>anchor.box.y1&&w.bbox.y0<anchor.box.y1+Math.max(80,height*.1));return words.length?[words]:[];}).sort((a,b)=>a[0].bbox.y0-b[0].bbox.y0);
    const words=candidates[0];if(!words)continue;
    const value=words.map(w=>w.text).join(' ').toUpperCase();
    fields[anchor.key]=anchor.key.endsWith('Date')?parseDate(value):anchor.key==='passportNumber'?value.match(/[A-Z0-9]{5,20}/)?.[0]||'':anchor.key==='nationality'?value.match(/[A-Z]{3,30}/)?.[0]||'':value.trim();
    if(fields[anchor.key])locations[anchor.key]={x:words[0].bbox.x0/width,y:Math.min(...words.map(w=>w.bbox.y0))/height,width:(words.at(-1)!.bbox.x1-words[0].bbox.x0)/width,height:(Math.max(...words.map(w=>w.bbox.y1))-Math.min(...words.map(w=>w.bbox.y0)))/height};
  }
  return {fields,locations};
}
export async function readImage(file:File,onProgress:(message:string)=>void):Promise<OcrResult>{
  if(!file.type.startsWith("image/"))throw new Error("القراءة الآلية متاحة للصور PNG وJPEG. يمكن إرفاق PDF وإدخال حقوله يدويًا.");
  const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();
  if(width*height>24_000_000)throw new Error("الصورة كبيرة جدًا للقراءة المحلية. استخدم صورة أصغر من 24 مليون بكسل.");
  const {createWorker}=await import("tesseract.js");
  const worker=await createWorker("eng",1,{workerPath:"/ocr/worker.min.js",corePath:"/ocr-core",langPath:"/ocr-data",logger:m=>{if(m.status==="recognizing text")onProgress(`قراءة المستند ${Math.round(m.progress*100)}٪`);else onProgress("تحميل محرك قراءة المستندات…");}});
  try{
    const result=await worker.recognize(file,{}, {text:true,blocks:true});const text=result.data.text;const {fields,locations}=extractLayout(text,result.data.blocks||[],width,height);
    return {fields,text,confidence:result.data.confidence,locations};
  }finally{await worker.terminate();}
}
