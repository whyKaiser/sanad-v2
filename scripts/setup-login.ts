import {readFileSync,writeFileSync,existsSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {parseEnv} from "node:util";
import {randomBytes} from "node:crypto";
import {hashPassword} from "../lib/sanad/password";
const filename=resolve(".env");
const original=existsSync(filename)?readFileSync(filename,"utf8"):"";
const config=parseEnv(original);
const rotate=process.argv.includes("--rotate");
if(config.SANAD_PASSWORD_HASH&&!rotate){console.log("A login already exists. Use --rotate only to replace it and invalidate sessions.");process.exit(0);}
const username=config.SANAD_USERNAME||"admin";
const password=randomBytes(24).toString("base64url");
const hash=await hashPassword(password);
const kept=original.split(/\r?\n/).filter(line=>!/^SANAD_(USERNAME|PASSWORD_HASH|DISPLAY_NAME)=/.test(line));
writeFileSync(filename,kept.join("\n").trimEnd()+`\nSANAD_USERNAME=${username}\nSANAD_PASSWORD_HASH=${hash}\nSANAD_DISPLAY_NAME=مراجع سَنَد\n`);
mkdirSync("work",{recursive:true});
writeFileSync("work/login-private.json",JSON.stringify({username,password},null,2));
writeFileSync("work/login-private.txt",`بيانات دخول سَنَد — احفظها بشكل خاص\nاسم المستخدم: ${username}\nكلمة المرور: ${password}\n\nملف محلي مستثنى من Git. لا تشاركه مع الجمهور.\n`);
console.log("Login created. Credentials: work/login-private.txt (ignored by Git). Password is not printed.");
