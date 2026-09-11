import { readFileSync, existsSync } from 'node:fs';
export const base=process.env.SANAD_TEST_URL||'http://localhost:5173';
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw Error('Integration tests are restricted to loopback.');
const credentials=process.env.SANAD_TEST_PASSWORD?{username:process.env.SANAD_TEST_USERNAME||'admin',password:process.env.SANAD_TEST_PASSWORD}:existsSync('work/login-private.json')?JSON.parse(readFileSync('work/login-private.json','utf8')):null;
let session:Promise<string>|undefined;
export function sessionCookie(){
  return session??= (async()=>{
    if(!credentials)throw Error('Run npm run setup:login before integration tests.');
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(credentials)});
    if(response.status!==200)throw Error(`Login failed: HTTP ${response.status}`);
    return response.headers.get('set-cookie')!.split(';')[0];
  })();
}
export async function request(path:string,method='GET',body?:unknown,extra:Record<string,string>={}){
  return fetch(base+path,{method,headers:{cookie:await sessionCookie(),origin:base,...(body instanceof FormData?{}:{'content-type':'application/json'}),...extra},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(path==='/api/assistant'?{...(body as object),provider:'local'}:body)});
}
