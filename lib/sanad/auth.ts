import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { z } from "zod";
import { randomToken, sha256, verifyPassword } from "./password";

export const sessionCookie="sanad_session";
const lifetime=8*60*60;
const responseHeaders={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export type User={userId:string;displayName:string;username:string};
function json(value:unknown,status=200,extra:Record<string,string>={}){return Response.json(value,{status,headers:{...responseHeaders,...extra}});}
function readCookie(value:string|null){const tokens=(value||"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(sessionCookie+"="));if(tokens.length!==1)return null;const token=tokens[0].slice(sessionCookie.length+1);return /^[a-f0-9]{64}$/.test(token)?token:null;}
export async function getCurrentUser(request?:Request):Promise<User|null>{
  if(!env.DB||!env.SANAD_USERNAME||!env.SANAD_PASSWORD_HASH)return null;
  const token=readCookie((request?.headers||await headers()).get("cookie"));if(!token)return null;
  const row=await env.DB.prepare("SELECT owner,username,auth_version FROM auth_sessions WHERE token_hash=? AND expires_at>?").bind(await sha256(token),Date.now()).first<{owner:string;username:string;auth_version:string}>();
  if(!row||row.auth_version!==await sha256(env.SANAD_PASSWORD_HASH)||row.username!==env.SANAD_USERNAME.toLowerCase())return null;
  return {userId:row.owner,username:row.username,displayName:env.SANAD_DISPLAY_NAME||"مراجع سَنَد"};
}
export async function handleAuth(request:Request):Promise<Response>{
  const url=new URL(request.url);
  if(request.method!=="POST")return json({error:"طريقة الطلب غير مسموحة."},405,{Allow:"POST"});
  if(request.headers.get("origin")!==url.origin||request.headers.get("sec-fetch-site")==="cross-site")return json({error:"مصدر الطلب غير مسموح."},403);
  if(!env.DB)return json({error:"خدمة الدخول غير متاحة."},503);
  const cookieAttributes=`Path=/; HttpOnly; SameSite=Strict${url.protocol==="https:"?"; Secure":""}`;
  if(url.pathname==="/api/auth/logout"){
    const token=readCookie(request.headers.get("cookie"));if(token)await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ok:true},200,{"Set-Cookie":`${sessionCookie}=; ${cookieAttributes}; Max-Age=0`});
  }
  if(url.pathname!=="/api/auth/login")return json({error:"المسار غير موجود."},404);
  if(!env.SANAD_USERNAME||!env.SANAD_PASSWORD_HASH)return json({error:"حساب سَنَد لم يُجهز بعد. راجع إعدادات التشغيل."},503);
  try{
    const raw=await request.text();if(raw.length>4096)return json({error:"بيانات الدخول غير صحيحة."},400);
    const input=z.object({username:z.string().trim().min(1).max(80),password:z.string().min(1).max(200)}).strict().parse(JSON.parse(raw));
    const now=Date.now();const window=Math.floor(now/300_000);
    const rateKey=await sha256(`${request.headers.get("cf-connecting-ip")||"local"}:${window}`);
    const attempts=await env.DB.prepare("INSERT INTO auth_attempts (id,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(rateKey,now+600_000).first<{attempts:number}>();
    if((attempts?.attempts||0)>10)return json({error:"محاولات دخول كثيرة. انتظر خمس دقائق."},429,{"Retry-After":"300"});
    const valid=await verifyPassword(input.password,env.SANAD_PASSWORD_HASH);
    if(!valid||input.username.toLowerCase()!==env.SANAD_USERNAME.toLowerCase())return json({error:"اسم المستخدم أو كلمة المرور غير صحيحة."},401);
    const token=randomToken();const username=env.SANAD_USERNAME.toLowerCase();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").bind(now),
      env.DB.prepare("DELETE FROM auth_attempts WHERE expires_at<=?").bind(now),
      env.DB.prepare("INSERT INTO auth_sessions (token_hash,owner,username,auth_version,expires_at) VALUES (?,?,?,?,?)").bind(await sha256(token),`sanad:${username}`,username,await sha256(env.SANAD_PASSWORD_HASH),now+lifetime*1000),
    ]);
    return json({ok:true},200,{"Set-Cookie":`${sessionCookie}=${token}; ${cookieAttributes}; Max-Age=${lifetime}`});
  }catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:"بيانات الدخول غير صحيحة."},400);return json({error:"تعذر تسجيل الدخول الآن. حاول مجددًا."},503);}
}
