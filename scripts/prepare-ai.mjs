import { build } from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
// A standalone module worker keeps framework dev overlays out of the worker scope.
await build({entryPoints:['lib/sanad/semantic.worker.ts'],outfile:'public/ai/semantic-worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'linked'});
await mkdir('public/ai',{recursive:true});
for(const file of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await copyFile(`node_modules/onnxruntime-web/dist/${file}`,`public/ai/${file}`);
console.log('Local semantic worker prepared.');
