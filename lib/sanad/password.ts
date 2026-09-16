const encoder = new TextEncoder();
const iterations = 100_000;
export function hex(bytes: ArrayBuffer | Uint8Array) { return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,"0")).join(""); }
export async function sha256(value: string) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
export function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function hashPassword(password: string, salt = randomToken(), minimumLength = 16) {
  if(password.length < minimumLength || password.length > 200) throw new Error(`Use a password between ${minimumLength} and 200 characters.`);
  return derivePassword(password,salt);
}
async function derivePassword(password:string,salt:string){
  const key = await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:encoder.encode(salt),iterations},key,256);
  return `pbkdf2-sha256:${iterations}:${salt}:${hex(hash)}`;
}
export async function verifyPassword(password: string, stored: string) {
  const parts=stored.split(":");
  // Enrollment policy belongs in hashPassword. Verify an existing provisioned
  // credential against its hash, including an explicitly configured demo login.
  if(parts.length!==4 || parts[0]!=="pbkdf2-sha256" || Number(parts[1])!==iterations || !/^[a-f0-9]{64}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3]) || password.length<1 || password.length>200)return false;
  const actual=await derivePassword(password,parts[2]);
  let difference=actual.length^stored.length;
  for(let i=0;i<actual.length;i++)difference|=actual.charCodeAt(i)^stored.charCodeAt(i);
  return difference===0;
}
