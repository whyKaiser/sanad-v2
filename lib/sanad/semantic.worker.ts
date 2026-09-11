import { pipeline, env } from "@huggingface/transformers";
import { intentExamples, Intent } from "./domain";
env.allowLocalModels=false;
env.backends.onnx.wasm!.numThreads=1;
env.backends.onnx.wasm!.wasmPaths={mjs:new URL('/ai/ort-wasm-simd-threaded.mjs',self.location.origin).href,wasm:new URL('/ai/ort-wasm-simd-threaded.wasm',self.location.origin).href};
let extractor: Awaited<ReturnType<typeof pipeline<"feature-extraction">>> | null=null;
let vectors: {intent:Intent; values:number[]}[]=[];
const normalizeVector=(v:number[])=>{const d=Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1;return v.map(x=>x/d);};
async function load(){
  if(extractor)return;
  extractor=await pipeline("feature-extraction","Xenova/paraphrase-multilingual-MiniLM-L12-v2",{
    dtype:"q8",device:"wasm",progress_callback:(p)=>self.postMessage({type:"progress",detail:p}),
  });
  self.postMessage({type:'progress',detail:{status:'stage',message:'تجهيز فهم الأسئلة على جهازك…'}});
  const pairs=(Object.entries(intentExamples) as [Intent,string[]][]).flatMap(([intent,examples])=>examples.map(text=>({intent,text})));
  const output=await extractor(pairs.map(p=>p.text),{pooling:"mean",normalize:true});
  const values=output.tolist() as number[][];
  vectors=pairs.map((p,i)=>({intent:p.intent,values:normalizeVector(values[i])}));
}
self.onmessage=async(event:MessageEvent<{id:string;type:"load"|"query";query?:string}>)=>{
  const {id,type,query}=event.data;
  try{
    await load();
    if(type==="load"){self.postMessage({id,type:"ready"});return;}
    const output=await extractor!(query!,{pooling:"mean",normalize:true});const vector=normalizeVector((output.tolist() as number[][])[0]);
    const ranked=vectors.map(v=>({intent:v.intent,score:v.values.reduce((s,x,i)=>s+x*vector[i],0)})).sort((a,b)=>b.score-a.score);
    const distinct=ranked.filter((v,i)=>ranked.findIndex(x=>x.intent===v.intent)===i);
    const certain=distinct[0]?.score>=0.5 && distinct[0].score-(distinct[1]?.score??0)>=0.035;
    self.postMessage({id,type:"result",intent:certain?distinct[0].intent:null,score:distinct[0]?.score??0});
  }catch(error){extractor=null;self.postMessage({id,type:"error",error:error instanceof Error?error.message:"Model unavailable"});}
};
