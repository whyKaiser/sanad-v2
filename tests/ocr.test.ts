import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from 'tesseract.js';
import {extractLayout} from '../lib/sanad/ocr';
test('Neural OCR extracts all five fields from the actual two-column sample image',async()=>{
 const worker=await createWorker('eng',1,{langPath:'public/ocr-data'});
 try{
  const result=await worker.recognize('public/samples/passport-sample.png',{}, {text:true,blocks:true});
  const extracted=extractLayout(result.data.text,result.data.blocks||[],1200,760);
  assert.deepEqual(extracted.fields,{name:'OMAR SALIM',passportNumber:'SND000101',nationality:'UTO',birthDate:'1990-04-12',expiryDate:'2030-04-12'});
  assert.equal(Object.keys(extracted.locations).length,5);
  assert.ok(extracted.locations.name!.x>0.27,'Name box excludes the photo placeholder');
 }finally{await worker.terminate();}
});
