import type { TravelFields, FieldLocation, FieldKey } from "./types";
import { extractLayout, ocrWarnings } from "./ocr-fields";
export { extractLayout, parseOcrText, parseOcrDate, ocrWarnings } from "./ocr-fields";
export type OcrResult={fields:TravelFields;text:string;confidence:number;locations:Partial<Record<FieldKey,FieldLocation>>;warnings:string[]};
export async function readImage(file:File,onProgress:(message:string)=>void):Promise<OcrResult>{
  if(!["image/png","image/jpeg"].includes(file.type))throw new Error("القراءة الآلية متاحة للصور PNG وJPEG. يمكن إرفاق PDF وإدخال حقوله يدويًا.");
  const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();
  if(width*height>24_000_000)throw new Error("الصورة كبيرة جدًا للقراءة المحلية. استخدم صورة أصغر من 24 مليون بكسل.");
  const {createWorker}=await import("tesseract.js");
  const worker=await createWorker("eng",1,{workerPath:"/ocr/worker.min.js",corePath:"/ocr-core",langPath:"/ocr-data",logger:m=>{if(m.status==="recognizing text")onProgress(`قراءة المستند ${Math.round(m.progress*100)}٪`);else onProgress("تحميل محرك قراءة المستندات…");}});
  try{
    const result=await worker.recognize(file,{}, {text:true,blocks:true});const text=result.data.text;const {fields,locations}=extractLayout(text,result.data.blocks||[],width,height);
    return {fields,text,confidence:result.data.confidence,locations,warnings:ocrWarnings(fields,result.data.confidence)};
  }finally{await worker.terminate();}
}
