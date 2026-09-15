import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { z } from "zod";
import { randomToken, sha256, verifyPassword } from "./password";
import { beginMutation, finishMutation, securityEvent, database } from "./integrity-server";
import type { Role } from "./integrated";

export const sessionCookie="sanad_v2_session";
const lifetime=8*60*60;
const responseHeaders={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export type User={userId:string;owner:string;displayName:string;username:string;role:Role};
export type StaffRow={id:string;owner:string;username:string;display_name:string;password_hash:string;role:Role;active:number;auth_version:string;revision:number};
function json(value:unknown,status=200,extra:Record<string,string>={}){return Response.json(value,{status,headers:{...responseHeaders,...extra}});}
function readCookie(value:string|null){const tokens=(value||"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(sessionCookie+"="));if(tokens.length!==1)return null;const token=tokens[0].slice(sessionCookie.length+1);return /^[a-f0-9]{64}$/.test(token)?token:null;}
function publicUser(row:StaffRow):User{return {userId:row.id,owner:row.owner,username:row.username,displayName:row.display_name,role:row.role};}
export async function bootstrap(){
 if(!env.SANAD_USERNAME||!env.SANAD_PASSWORD_HASH)return;
 const db=database();const existing=await db.prepare("SELECT * FROM staff_users WHERE username=?").bind(env.SANAD_USERNAME.toLowerCase()).first<StaffRow>();
 if(existing){
  if(existing.password_hash!==env.SANAD_PASSWORD_HASH){const user=publicUser(existing);const token=await beginMutation(user,'rotate_bootstrap','تدوير كلمة مرور المسؤول عبر إعدادات الخادم');try{await db.prepare("UPDATE staff_users SET password_hash=?,auth_version=?,revision=revision+1 WHERE id=? AND owner=?").bind(env.SANAD_PASSWORD_HASH,randomToken(),existing.id,existing.owner).run();}finally{await finishMutation(existing.owner,token);}}
  return;
 }
 const username=env.SANAD_USERNAME.toLowerCase();const owner=`sanad-v2:${username}`;
 const user:User={userId:crypto.randomUUID(),owner,username,displayName:env.SANAD_DISPLAY_NAME||"مسؤول سَنَد",role:"admin"};
 const token=await beginMutation(user,"bootstrap","تهيئة حساب مسؤول سَنَد");
 try{await db.prepare("INSERT INTO staff_users(id,owner,username,display_name,password_hash,role,auth_version,created_at) VALUES (?,?,?,?,?,'admin',?,?)").bind(user.userId,owner,username,user.displayName,env.SANAD_PASSWORD_HASH,randomToken(),new Date().toISOString()).run();}
 finally{await finishMutation(owner,token);}
}
export async function getCurrentUser(request?:Request):Promise<User|null>{
 if(!env.DB)return null;
 const token=readCookie((request?.headers||await headers()).get("cookie"));if(!token)return null;
 const row=await env.DB.prepare("SELECT u.* FROM auth_sessions s JOIN staff_users u ON u.username=s.username AND u.owner=s.owner WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND u.auth_version=s.auth_version").bind(await sha256(token),Date.now()).first<StaffRow>();
 if(row&&row.username===env.SANAD_USERNAME?.toLowerCase()&&row.password_hash!==env.SANAD_PASSWORD_HASH)return null;
 return row?publicUser(row):null;
}
export async function handleAuth(request:Request):Promise<Response>{
 const url=new URL(request.url);
 if(request.method!=="POST")return json({error:"طريقة الطلب غير مسموحة."},405,{Allow:"POST"});
 if(request.headers.get("origin")!==url.origin||request.headers.get("sec-fetch-site")==="cross-site")return json({error:"مصدر الطلب غير مسموح."},403);
 if(!env.DB)return json({error:"خدمة الدخول غير متاحة."},503);
 const cookieAttributes=`Path=/; HttpOnly; SameSite=Strict${url.protocol==="https:"?"; Secure":""}`;
 try{
  if(url.pathname==="/api/auth/logout"){
   const token=readCookie(request.headers.get("cookie"));if(token)await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await sha256(token)).run();
   return json({ok:true},200,{"Set-Cookie":`${sessionCookie}=; ${cookieAttributes}; Max-Age=0`});
  }
  if(url.pathname!=="/api/auth/login")return json({error:"المسار غير موجود."},404);
  if(!env.SANAD_USERNAME||!env.SANAD_PASSWORD_HASH)return json({error:"حساب سَنَد لم يُجهز بعد."},503);
  const raw=await request.text();if(raw.length>4096)return json({error:"بيانات الدخول غير صحيحة."},400);
  const input=z.object({username:z.string().trim().min(1).max(80),password:z.string().min(1).max(200)}).strict().parse(JSON.parse(raw));
  const now=Date.now();const window=Math.floor(now/300_000);const ip=request.headers.get("cf-connecting-ip")||"local";
  const rateKey=await sha256(`${ip}:${input.username.toLowerCase()}:${window}`);
  const ipKey=await sha256(`aggregate:${ip}:${window}`);
  const aggregate=await env.DB.prepare("INSERT INTO auth_attempts(id,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(ipKey,now+600_000).first<{attempts:number}>();
  if((aggregate?.attempts||0)>100)return json({error:"محاولات دخول كثيرة من هذه الشبكة. انتظر خمس دقائق."},429,{"Retry-After":"300"});
  const attempts=await env.DB.prepare("INSERT INTO auth_attempts(id,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(rateKey,now+600_000).first<{attempts:number}>();
  if((attempts?.attempts||0)>10)return json({error:"محاولات دخول كثيرة. انتظر خمس دقائق."},429,{"Retry-After":"300"});
  await bootstrap();
  const row=await env.DB.prepare("SELECT * FROM staff_users WHERE username=?").bind(input.username.toLowerCase()).first<StaffRow>();
  const valid=await verifyPassword(input.password,row?.password_hash||env.SANAD_PASSWORD_HASH);
  if(!valid||!row?.active){await securityEvent(row?.owner||`sanad-v2:${env.SANAD_USERNAME.toLowerCase()}`,row?.id||"unknown","login_failed","محاولة دخول لم تنجح");return json({error:"اسم المستخدم أو كلمة المرور غير صحيحة."},401);}
  const token=randomToken();await env.DB.batch([
   env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").bind(now),env.DB.prepare("DELETE FROM auth_attempts WHERE expires_at<=?").bind(now),
   env.DB.prepare("INSERT INTO auth_sessions(token_hash,owner,username,auth_version,expires_at) VALUES (?,?,?,?,?)").bind(await sha256(token),row.owner,row.username,row.auth_version,now+lifetime*1000),
  ]);
  await securityEvent(row.owner,row.id,"login_success","دخول موظف إلى سَنَد");
  return json({ok:true,user:publicUser(row)},200,{"Set-Cookie":`${sessionCookie}=${token}; ${cookieAttributes}; Max-Age=${lifetime}`});
 }catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:"بيانات الدخول غير صحيحة."},400);console.error("sanad_v2_login_failed",error instanceof Error?error.name:"unknown");return json({error:"تعذر تسجيل الدخول الآن. حاول مجددًا."},503);}
}
