import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from 'tesseract.js';
import {extractLayout,parseOcrText,parseOcrDate,ocrWarnings} from '../lib/sanad/ocr';
import sharp from 'sharp';
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

test('OCR dates validate the calendar and require unambiguous ordering',()=>{
 assert.equal(parseOcrDate('2024/02/29'),'2024-02-29');
 assert.equal(parseOcrDate('31 JAN 1990'),'1990-01-31');
 assert.equal(parseOcrDate('31/01/1990'),'1990-01-31');
 assert.equal(parseOcrDate('01/31/1990'),'1990-01-31');
 for(const value of ['2025-02-29','2030-04-31','04/12/1990','2030-13-01'])assert.equal(parseOcrDate(value),'',value);
});

test('Missing values never consume the next label; unchecked MRZ never replaces visible fields',()=>{
 const fields=parseOcrText('FULL NAME:\nPASSPORT NO: SND000102\nNATIONALITY:\nDOB: 1990-02-30\nDATE OF EXPIRATION: 31 JAN 2030\nP<UTOFAKE<<PERSON<<<<<<<<<<<<<<<<<<<<<<<<<<<<\nWRONGDATA00000000000000000000000000000000000<');
 assert.equal(fields.name,'');assert.equal(fields.nationality,'');assert.equal(fields.birthDate,'');
 assert.equal(fields.passportNumber,'SND000102');assert.equal(fields.expiryDate,'2030-01-31');
 assert.ok(ocrWarnings(fields,55).some(w=>w.includes('منخفضة')));
 assert.ok(ocrWarnings(fields,95).some(w=>w.includes('الاسم')));
});

test('Neural OCR reads inline PNG, compressed JPEG, and resized PNG with alternate labels and dates',async t=>{
 const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="820"><rect width="1400" height="820" fill="white"/><g font-family="Arial" fill="#111"><text x="60" y="70" font-size="26">SYNTHETIC TEST DOCUMENT - NOT VALID FOR TRAVEL</text>${[
  'FULL NAME: OMAR SALIM','PASSPORT NO: SND000102','NATIONALITY: UTO','DOB: 31 JAN 1990','DATE OF EXPIRATION: 31 JAN 2030'
 ].map((s,i)=>`<text x="70" y="${180+i*125}" font-size="38">${s}</text>`).join('')}</g></svg>`);
 const worker=await createWorker('eng',1,{langPath:'public/ocr-data'});
 try{
  for(const variant of ['inline-png','compressed-jpeg','resized-png'])await t.test(variant,async()=>{
   const width=variant==='resized-png'?1120:1400,height=variant==='resized-png'?656:820;
   const pipeline=sharp(svg).resize(width,height);const bytes=variant==='compressed-jpeg'?await pipeline.jpeg({quality:62}).toBuffer():await pipeline.png().toBuffer();
   const result=await worker.recognize(bytes,{}, {text:true,blocks:true});
   const actual=extractLayout(result.data.text,result.data.blocks||[],width,height);
   assert.deepEqual(actual.fields,{name:'OMAR SALIM',passportNumber:'SND000102',nationality:'UTO',birthDate:'1990-01-31',expiryDate:'2030-01-31'});
   assert.equal(Object.keys(actual.locations).length,5);
   for(const box of Object.values(actual.locations)){assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1&&box.y+box.height<=1);}
  });
 }finally{await worker.terminate();}
});
