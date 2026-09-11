import { mkdir, copyFile } from 'node:fs/promises';
import sharp from 'sharp';
import { syntheticSvg, demoRecord } from '../lib/sanad/demo';
await mkdir('public/samples',{recursive:true});
await mkdir('public/fonts',{recursive:true});
const record=demoRecord(0);
await sharp(Buffer.from(syntheticSvg({name:record.englishName,passportNumber:record.passportNumber,nationality:record.nationality,birthDate:record.birthDate,expiryDate:'2030-04-12'},'passport'))).png().toFile('public/samples/passport-sample.png');
for(const weight of [400,500,600,700])for(const subset of ['arabic','latin']){
  const name=`ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`;
  await copyFile(`node_modules/@fontsource/ibm-plex-sans-arabic/files/${name}`,`public/fonts/${name}`);
}
console.log('Synthetic sample and local fonts prepared.');
