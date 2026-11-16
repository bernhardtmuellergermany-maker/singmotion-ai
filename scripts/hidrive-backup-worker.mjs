/**
 * Standalone, non-public STRATO HiDrive OAuth bootstrap / synthetic probe.
 * No imports from the SingMotion app, payment ledger or private media mounts.
 * The encryption key is derived from the sealed HiDrive client_secret using
 * separate HKDF contexts and random salt. Rotating client_secret requires new
 * HiDrive authorization; never log credentials, codes, tokens or object bytes.
 */
import {randomBytes,randomUUID,createCipheriv,createDecipheriv,hkdfSync,timingSafeEqual} from "node:crypto";
import {open,readFile,rename,lstat} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const STATE_PATH="/state/hidrive-oauth.v1.json.enc";
export const AUTH_BASE="https://my.hidrive.com/client/authorize";
export const TOKEN_URL="https://my.hidrive.com/oauth2/token";
export const TOKENINFO_URL="https://my.hidrive.com/oauth2/tokeninfo";
export const HIDRIVE_API="https://api.hidrive.strato.com/2.1";
const MODES=new Set(["SETUP_ONLY_NO_DATA_TRANSFER","AUTH_EXCHANGE_ONLY","PROBE_ONLY"]);
const MSG="HIDRIVE_BACKUP_FAILED";

export class SafeError extends Error {
 constructor(code){super(code);this.name="SafeError";}
}

export function authorizationURL(clientId){
 if(typeof clientId!=="string"||!clientId.trim()||clientId.length>256||/[\s&?#]/.test(clientId))
  throw new SafeError("INVALID_CLIENT_ID");
 const url=new URL(AUTH_BASE);
 url.searchParams.set("client_id",clientId);
 url.searchParams.set("response_type","code");
 url.searchParams.set("scope","user,rw");
 url.searchParams.set("redirect_uri","oob");
 url.searchParams.set("lang","de");
 return url.toString();
}

export function privatePath(alias,folder="SingMotion-DR"){
 if(typeof alias!=="string"||!/^[A-Za-z0-9._-]{1,100}$/.test(alias)||alias==="."||alias==="..")
  throw new SafeError("INVALID_HIDRIVE_ALIAS");
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(folder)||folder!=="SingMotion-DR")
  throw new SafeError("INVALID_BACKUP_FOLDER");
 return "root/users/"+alias+"/"+folder;
}

export function scopeAllowed(scope){
 // HiDrive may grant a different scope from the one requested in the OAuth URL.
 // Fail closed unless the grant is exactly the least-privileged user,rw pair.
 const parts=(typeof scope==="string"?scope:"").split(",").map(x=>x.trim().toLowerCase());
 return parts.length===2&&new Set(parts).size===2&&parts.includes("user")&&parts.includes("rw");
}

export function seal(payload,clientSecret,context="oauth"){
 if(typeof clientSecret!=="string"||clientSecret.length<8)
  throw new SafeError("MISSING_CLIENT_SECRET");
 if(!["oauth","fixture"].includes(context))throw new SafeError("INVALID_ENCRYPTION_CONTEXT");
 const salt=randomBytes(32),iv=randomBytes(12);
 const key=Buffer.from(hkdfSync("sha256",Buffer.from(clientSecret,"utf8"),salt,
   Buffer.from("singmotion-hidrive-"+context+"-aes256gcm-v1"),32));
 const cipher=createCipheriv("aes-256-gcm",key,iv);
 const plain=Buffer.isBuffer(payload)?payload:Buffer.from(JSON.stringify(payload));
 cipher.setAAD(Buffer.from("singmotion-hidrive-"+context+"-v1"));
 const ct=Buffer.concat([cipher.update(plain),cipher.final()]);
 const envelope={v:1,context,salt:salt.toString("base64"),iv:iv.toString("base64"),
  tag:cipher.getAuthTag().toString("base64"),ct:ct.toString("base64")};
 key.fill(0);
 return Buffer.from(JSON.stringify(envelope));
}

export function unseal(encoded,clientSecret,context="oauth"){
 try{
  if(!Buffer.isBuffer(encoded)||encoded.length>65536||encoded.length<60)throw Error();
  const obj=JSON.parse(encoded.toString("utf8"));
  if(obj.v!==1||obj.context!==context)throw Error();
  const salt=Buffer.from(obj.salt,"base64"),iv=Buffer.from(obj.iv,"base64");
  const tag=Buffer.from(obj.tag,"base64"),ct=Buffer.from(obj.ct,"base64");
  if(salt.length!==32||iv.length!==12||tag.length!==16||ct.length<1)throw Error();
  const key=Buffer.from(hkdfSync("sha256",Buffer.from(clientSecret,"utf8"),salt,
   Buffer.from("singmotion-hidrive-"+context+"-aes256gcm-v1"),32));
  const dec=createDecipheriv("aes-256-gcm",key,iv);
  dec.setAAD(Buffer.from("singmotion-hidrive-"+context+"-v1"));
  dec.setAuthTag(tag);
  const result=Buffer.concat([dec.update(ct),dec.final()]);
  key.fill(0);
  return result;
 }catch{throw new SafeError("ENCRYPTED_STATE_UNREADABLE");}
}

function need(value,code){
 if(typeof value!=="string"||!value.trim())throw new SafeError(code);
 return value.trim();
}
async function postForm(url,form){
 let response;
 try{
  response=await fetch(url,{method:"POST",redirect:"error",
   headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-store"},
   body:new URLSearchParams(form),signal:AbortSignal.timeout(18000)});
 }catch{throw new SafeError("OAUTH_ENDPOINT_UNREACHABLE");}
 if(!response.ok)throw new SafeError("OAUTH_HTTP_"+response.status);
 let json;
 try{
  const raw=await response.text();
  if(raw.length>16384)throw Error();
  json=JSON.parse(raw);
 }catch{throw new SafeError("OAUTH_RESPONSE_INVALID");}
 return json;
}
function parseGrant(grant,previous={}){
 if(!grant||typeof grant.access_token!=="string"||grant.access_token.length<10||
   typeof grant.refresh_token!=="string"||grant.refresh_token.length<10||
   !scopeAllowed(grant.scope??previous.scope))
  throw new SafeError("OAUTH_GRANT_INVALID_OR_READONLY");
 return {access_token:grant.access_token,refresh_token:grant.refresh_token,
  scope:grant.scope??previous.scope,alias:grant.alias??previous.alias??null,
  acquiredAt:new Date().toISOString()};
}
async function tokenInfo(accessToken){
 const info=await postForm(TOKENINFO_URL,{access_token:accessToken});
 if(!scopeAllowed(info.scope))throw new SafeError("OAUTH_SCOPE_NOT_READWRITE");
 return info;
}
async function ensureStateDir(){
 const info=await lstat("/state").catch(()=>null);
 if(!info||!info.isDirectory()||info.isSymbolicLink()||
    (info.mode&0o077)!==0)
   throw new SafeError("PRIVATE_VOLUME_UNAVAILABLE");
 if(typeof process.getuid==="function"&&process.getuid()!==1000)
   throw new SafeError("REFUSE_ROOT_RUNTIME");
}
async function loadState(secret){
 const info=await lstat(STATE_PATH).catch(()=>null);
 if(!info||!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)!==0)
  throw new SafeError("OAUTH_STATE_MISSING_OR_INSECURE");
 const encrypted=await readFile(STATE_PATH);
 let payload;
 try{payload=JSON.parse(unseal(encrypted,secret,"oauth").toString("utf8"));}
 catch{throw new SafeError("OAUTH_STATE_UNREADABLE");}
 if(!payload||typeof payload.refresh_token!=="string"||payload.refresh_token.length<10)
  throw new SafeError("OAUTH_STATE_INVALID");
 return payload;
}
async function saveState(data,secret){
 const tmp=path.join("/state",".oauth-"+randomUUID()+".tmp");
 const fh=await open(tmp,"wx",0o600);
 try{
  await fh.writeFile(seal(data,secret,"oauth"));
  await fh.sync();
 }finally{await fh.close();}
 await rename(tmp,STATE_PATH);
}
async function hidriveRequest(accessToken,method,endpoint,params,body){
 const url=new URL(HIDRIVE_API+endpoint);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
 let response;
 try{
  response=await fetch(url,{method,redirect:"error",headers:{
   Authorization:"Bearer "+accessToken,
   ...(body?{"Content-Type":"application/octet-stream","Cache-Control":"no-store"}:{})
  },body:body??undefined,signal:AbortSignal.timeout(30000)});
 }catch{throw new SafeError("HIDRIVE_API_UNREACHABLE");}
 return response;
}
async function verifyPrivateFolder(accessToken,alias,folder){
 const dir=privatePath(alias,folder);
 const response=await hidriveRequest(accessToken,"GET","/dir",{path:dir,fields:"path,type,writable,readable"},null);
 if(!response.ok)throw new SafeError("PRIVATE_FOLDER_HTTP_"+response.status);
 let data;
 try{data=await response.json();}catch{throw new SafeError("PRIVATE_FOLDER_RESPONSE_INVALID");}
 if(data?.type&&data.type!=="dir")throw new SafeError("TARGET_IS_NOT_DIRECTORY");
 if(data?.writable===false)throw new SafeError("PRIVATE_FOLDER_NOT_WRITABLE");
 return dir;
}
async function syntheticProbe(accessToken,secret,dir){
 const filename="singmotion-synthetic-probe-"+randomUUID()+".enc";
 const plain=Buffer.from("singmotion-cloud-test-"+randomUUID());
 const ciphertext=seal(plain,secret,"fixture");
 let response=await hidriveRequest(accessToken,"PUT","/file",{dir,name:filename},ciphertext);
 if(!response.ok)throw new SafeError("SYNTHETIC_UPLOAD_HTTP_"+response.status);
 response=await hidriveRequest(accessToken,"GET","/file",{path:dir+"/"+filename},null);
 if(!response.ok)throw new SafeError("SYNTHETIC_DOWNLOAD_HTTP_"+response.status);
 let fetched;
 try{
  const arr=await response.arrayBuffer();
  if(arr.byteLength>16384)throw Error();
  fetched=Buffer.from(arr);
 }catch{throw new SafeError("SYNTHETIC_READBACK_FAILED");}
 if(fetched.length!==ciphertext.length||!timingSafeEqual(fetched,ciphertext)||
  !timingSafeEqual(unseal(fetched,secret,"fixture"),plain))
  throw new SafeError("SYNTHETIC_INTEGRITY_MISMATCH");
 response=await hidriveRequest(accessToken,"DELETE","/file",{path:dir+"/"+filename},null);
 if(!response.ok)throw new SafeError("SYNTHETIC_DELETE_HTTP_"+response.status);
 response=await hidriveRequest(accessToken,"GET","/file",{path:dir+"/"+filename},null);
 if(response.status!==404)throw new SafeError("SYNTHETIC_DELETE_UNVERIFIED");
 console.log("HIDRIVE_SYNTHETIC_ENCRYPTED_ROUNDTRIP_VERIFIED");
}
export async function main(env=process.env){
 const mode=env.BACKUP_MODE??"SETUP_ONLY_NO_DATA_TRANSFER";
 if(!MODES.has(mode))throw new SafeError("BACKUP_MODE_UNSUPPORTED");
 if(env.BACKUP_ENABLED!=="false")throw new SafeError("REAL_BACKUP_NOT_IMPLEMENTED");
 if(env.BACKUP_PROVIDER!=="STRATO_HIDRIVE")throw new SafeError("WRONG_BACKUP_PROVIDER");
 if(env.RAILWAY_SERVICE_NAME!=="singmotion-backup")throw new SafeError("WRONG_RAILWAY_SERVICE");
 if(mode==="SETUP_ONLY_NO_DATA_TRANSFER"){
  console.log("HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER");
  return;
 }
 await ensureStateDir();
 const clientId=need(env.HIDRIVE_CLIENT_ID,"MISSING_CLIENT_ID");
 const secret=need(env.HIDRIVE_CLIENT_SECRET,"MISSING_CLIENT_SECRET");
 const folder=need(env.HIDRIVE_BACKUP_FOLDER,"MISSING_FOLDER");
 if(mode==="AUTH_EXCHANGE_ONLY"){
  const code=need(env.HIDRIVE_AUTH_CODE,"OOB_CODE_NOT_SET");
  if(code.length>256||/[\s]/.test(code))throw new SafeError("INVALID_OOB_CODE");
  const exists=await lstat(STATE_PATH).then(()=>true).catch(()=>false);
  if(exists&&env.HIDRIVE_REAUTHORIZE_APPROVED!=="YES")
   throw new SafeError("OAUTH_ALREADY_INITIALIZED");
  const grant=parseGrant(await postForm(TOKEN_URL,{
   client_id:clientId,client_secret:secret,grant_type:"authorization_code",code}));
  // Save the refresh token persistently before validating network access.
  // Repeated calls with a used code must fail rather than replace the saved state.
  await saveState(grant,secret);
  const info=await tokenInfo(grant.access_token);
  if(info.alias&&info.alias!==grant.alias){
   grant.alias=info.alias;
   await saveState(grant,secret);
  }
  console.log("HIDRIVE_OAUTH_AUTHORIZED_ENCRYPTED_STATE_SAVED");
  return;
 }
 const previous=await loadState(secret);
 const fresh=parseGrant(await postForm(TOKEN_URL,{
  client_id:clientId,client_secret:secret,grant_type:"refresh_token",
  refresh_token:previous.refresh_token}),previous);
 // Persist potentially rotated refresh token BEFORE any other network operation.
 await saveState(fresh,secret);
 const info=await tokenInfo(fresh.access_token);
 const alias=need(info.alias??fresh.alias,"HIDRIVE_ALIAS_UNAVAILABLE");
 if(alias!==fresh.alias){fresh.alias=alias;await saveState(fresh,secret);}
 const dir=await verifyPrivateFolder(fresh.access_token,alias,folder);
 console.log("HIDRIVE_PRIVATE_FOLDER_READWRITE_VERIFIED");
 if(env.HIDRIVE_SYNTHETIC_TEST_APPROVED==="YES")
  await syntheticProbe(fresh.access_token,secret,dir);
 console.log("HIDRIVE_OAUTH_REFRESH_PERSISTED");
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 main().catch(error=>{
  console.error(MSG,error instanceof SafeError?error.message:"UNEXPECTED_ERROR");
  process.exitCode=1;
 });
}
