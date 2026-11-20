import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {normalizeSunoSongLink} from "./suno-song-link.ts";

export const SUNO_STAGING_ORIGIN="https://singmotion-ai-staging.up.railway.app";
export const SUNO_MCP_RESOURCE="https://api.suno.com/mcp";
export const SUNO_OAUTH_REGISTER="https://studio-api-prod.suno.com/api/v2/external/oauth/register/";
export const SUNO_OAUTH_AUTHORIZE="https://studio-api-prod.suno.com/api/v2/external/oauth/authorize/";
export const SUNO_OAUTH_TOKEN="https://studio-api-prod.suno.com/api/v2/external/oauth/token/";
export const SUNO_OAUTH_SCOPES="api:v0 download library:read offline_access profile:read";
export const SUNO_MAX_AUDIO_BYTES=50*1024*1024;
export const SUNO_STAGING_ENV="dfaeabed-03df-43ed-aa71-50f343a75041";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export const sunoStagingOnly=(env:Record<string,string|undefined>=process.env)=>
  env.RAILWAY_ENVIRONMENT_ID===SUNO_STAGING_ENV;

export function pkcePair(){
 const verifier=randomBytes(32).toString("base64url");
 return {verifier,challenge:createHash("sha256").update(verifier).digest("base64url"),state:randomBytes(32).toString("base64url")};
}
export function oauthClientRegistration(redirectUri:string){
 return {client_name:"SingMotion AI Staging (user-authorized Suno song import)",
  redirect_uris:[redirectUri],grant_types:["authorization_code","refresh_token"],
  response_types:["code"],token_endpoint_auth_method:"none",scope:SUNO_OAUTH_SCOPES};
}
export function authorizationUrl(clientId:string,redirectUri:string,pkce:ReturnType<typeof pkcePair>){
 const uri=new URL(SUNO_OAUTH_AUTHORIZE);
 for(const [k,v] of Object.entries({response_type:"code",client_id:clientId,
   redirect_uri:redirectUri,state:pkce.state,code_challenge:pkce.challenge,
   code_challenge_method:"S256",scope:SUNO_OAUTH_SCOPES,resource:SUNO_MCP_RESOURCE}))
  uri.searchParams.set(k,v);
 return uri.toString();
}

type SunoAuthCookie={owner:string;mediaToken:string;state:string;verifier:string;clientId:string};
export function readSunoOAuthCookie(raw:string|undefined):SunoAuthCookie|null{
 if(!raw||raw.length>2400)return null;
 try{
  const v=JSON.parse(raw) as Partial<SunoAuthCookie>;
  if(typeof v.owner!=="string"||v.owner.length>130||
     typeof v.mediaToken!=="string"||! /^[A-Za-z0-9_-]{40,150}$/.test(v.mediaToken)||
     typeof v.state!=="string"||! /^[A-Za-z0-9_-]{40,100}$/.test(v.state)||
     typeof v.verifier!=="string"||! /^[A-Za-z0-9_-]{40,100}$/.test(v.verifier)||
     typeof v.clientId!=="string"||v.clientId.length<8||v.clientId.length>300)return null;
  return v as SunoAuthCookie;
 }catch{return null;}
}
export function signSunoAccessToken(mediaToken:string,owner:string,accessToken:string,expiresIn:number){
 if(!accessToken||accessToken.length>2600||owner.length>130||
    !Number.isFinite(expiresIn)||expiresIn<=60)throw Error("Invalid short-lived Suno access");
 const ttl=Math.min(780,Math.floor(expiresIn)-30);
 const payload=Buffer.from(JSON.stringify({owner,accessToken,expiresAt:Date.now()+ttl*1000})).toString("base64url");
 const signature=createHmac("sha256",mediaToken).update("suno-oauth-v1:"+payload).digest("base64url");
 const cookie=payload+"."+signature;
 if(cookie.length>3650)throw Error("Suno OAuth token exceeds secure cookie capacity");
 return {cookie,ttl};
}
export function verifySunoAccessToken(cookie:string|undefined,mediaToken:string,owner:string,now=Date.now()):string|null{
 if(!cookie||cookie.length>3700||!mediaToken)return null;
 const parts=cookie.split(".");
 if(parts.length!==2||! /^[A-Za-z0-9_-]+$/.test(parts[0])||
    ! /^[A-Za-z0-9_-]{43}$/.test(parts[1]))return null;
 const expected=createHmac("sha256",mediaToken).update("suno-oauth-v1:"+parts[0]).digest("base64url");
 if(!timingSafeEqual(Buffer.from(expected),Buffer.from(parts[1])))return null;
 try{
  const v=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8")) as {owner?:unknown;accessToken?:unknown;expiresAt?:unknown};
  return v.owner===owner&&typeof v.accessToken==="string"&&v.accessToken.length>10&&
    typeof v.expiresAt==="number"&&v.expiresAt>now&&v.expiresAt<=now+15*60*1000
    ?v.accessToken:null;
 }catch{return null;}
}
export function isAllowedSunoDownloadUrl(raw:string){
 try{
  const u=new URL(raw);
  return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&
   (u.hostname==="suno.com"||u.hostname.endsWith(".suno.com")||
    u.hostname==="suno.ai"||u.hostname.endsWith(".suno.ai")||
    // Suno's own presigned S3 download bucket. Never allow generic amazonaws.com.
    u.hostname==="suno-data-uploads.s3.amazonaws.com");
 }catch{return false;}
}
export function extractSunoSongId(url:string):string|null{
 const canonical=normalizeSunoSongLink(url);
 if(!canonical)return null;
 const x=new URL(canonical);
 const part=/^\/song\/([^/]+)$/.exec(x.pathname)?.[1];
 return part&&uuid.test(part)?part.toLowerCase():null;
}
/** Resolve only ordinary HTTP redirects issued by suno.com, never scrape page
 * content or guess private media CDN URLs. A short link may fail closed. */
export async function resolveSunoSongId(link:string,request:typeof fetch=fetch):Promise<string|null>{
 const canonical=normalizeSunoSongLink(link);
 if(!canonical)return null;
 const direct=extractSunoSongId(canonical);
 if(direct)return direct;
 let url=canonical;
 for(let i=0;i<4;i++){
  const response=await request(url,{method:i===0?"HEAD":"GET",redirect:"manual",
    signal:AbortSignal.timeout(9000),headers:{"Accept":"text/html"}});
  void response.body?.cancel().catch(()=>{});
  if(![301,302,303,307,308].includes(response.status)){
    if(i===0&&(response.status===405||response.status===200))continue;
    return extractSunoSongId(response.url);
  }
  const location=response.headers.get("location");
  if(!location)return null;
  const target=new URL(location,url);
  if(target.protocol!=="https:"||!["suno.com","www.suno.com"].includes(target.hostname)||
    target.username||target.password||target.port)return null;
  const id=extractSunoSongId(target.toString());
  if(id)return id;
  if(!normalizeSunoSongLink(target.toString()))return null;
  url=target.toString();
 }
 return null;
}
function parseRpcPayload(body:string){
 try{
  const raw=body.trim();
  const lines=raw.startsWith("data:")||raw.includes("\ndata:")
    ?raw.split(/\r?\n/).filter(x=>x.startsWith("data:")).map(x=>x.slice(5).trim()).filter(x=>x!=="[DONE]")
    :[raw];
  for(const item of lines.reverse()){
   const v=JSON.parse(item) as Record<string,unknown>;
   if(v.jsonrpc==="2.0"&&("result" in v||"error" in v))return v;
  }
 }catch{/* reject unsafe or unexpected third-party payload */}
 throw Error("Suno MCP returned an unsupported response");
}
/** Only send fixed, allowlisted calls to the official user-authorized MCP. */
export async function sunoMcpDownload(accessToken:string,id:string,confirm:boolean,request:typeof fetch=fetch){
 if(!uuid.test(id))throw Error("Invalid Suno song identifier");
 let sessionId:string|undefined;
 const rpc=async(method:string,params:object,notification=false)=>{
  const payload=notification
   ?{jsonrpc:"2.0",method,params}
   :{jsonrpc:"2.0",id:1,method,params};
  const r=await request(SUNO_MCP_RESOURCE,{method:"POST",redirect:"error",
   signal:AbortSignal.timeout(15000),
   headers:{"Authorization":"Bearer "+accessToken,"Content-Type":"application/json",
    "Accept":"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18",
    ...(sessionId?{"Mcp-Session-Id":sessionId}:{})},
   body:JSON.stringify(payload)});
  sessionId=r.headers.get("mcp-session-id")||sessionId;
  const raw=await r.text();
  if(!r.ok)throw Error("Suno MCP connection unavailable or authorization expired");
  if(notification)return null;
  const value=parseRpcPayload(raw);
  if(value.error)throw Error("Suno MCP rejected the request");
  return value.result as Record<string,unknown>;
 };
 const init=await rpc("initialize",{protocolVersion:"2025-06-18",capabilities:{},
   clientInfo:{name:"SingMotion Staging",version:"0.1"}});
 const protocol=typeof init?.protocolVersion==="string"?init.protocolVersion:"2025-06-18";
 void protocol;
 await rpc("notifications/initialized",{},true);
 const result=await rpc("tools/call",{name:"audio-download",arguments:{id,format:"mp3",...(confirm?{confirm:true}:{})}});
 if(result?.isError)throw Error("Suno rejected this song download; check your Suno download credits and permissions");
 let data:Record<string,unknown>|null=null;
 if(result?.structuredContent&&typeof result.structuredContent==="object"&&!Array.isArray(result.structuredContent))
  data=result.structuredContent as Record<string,unknown>;
 if(!data){
  const blocks=Array.isArray(result?.content)?result.content:[];
  for(const block of blocks){
   if(typeof block==="object"&&block!==null&&"text" in block&&typeof block.text==="string"){
    try{const x=JSON.parse(block.text);if(x&&typeof x==="object"&&!Array.isArray(x)){data=x;break}}catch{/* ignore prose */}
   }
  }
 }
 if(!data)throw Error("Suno provided no structured download response");
 const status=String(data.status||"");
 const url=typeof data.url==="string"?data.url:"";
 if(url){
  if(!isAllowedSunoDownloadUrl(url)){
   // Provider-generated signed URLs may use a delegated CDN. Record only its
   // hostname for verification; never log signed query strings or access tokens.
   // Do not automatically trust arbitrary CDN domains (SSRF boundary).
   let rejectedHost="invalid-url";
   try{rejectedHost=new URL(url).hostname}catch{/* no URL to inspect */}
   console.warn("[suno-import] rejected provider audio download host",{
    hostname:rejectedHost,
   });
   throw Error("Suno returned an unapproved audio download host");
  }
  return {status:"ready" as const,url};
 }
 if(status==="requires_credit")return {status:"requires_credit" as const,url:null};
 if(status==="processing")return {status:"processing" as const,url:null};
 throw Error("The Suno song is not available to download from this account");
}
export async function downloadAuthorizedSunoMp3(url:string,request:typeof fetch=fetch):Promise<Buffer>{
 if(!isAllowedSunoDownloadUrl(url))throw Error("Suno download host not allowed");
 const r=await request(url,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(45000),
  headers:{Accept:"audio/mpeg,application/octet-stream"}});
 if(!r.ok||r.status>=300)throw Error("Suno's authorized download URL is unavailable");
 const declared=Number(r.headers.get("content-length")||0);
 if((declared>0&&declared>SUNO_MAX_AUDIO_BYTES)||!r.body)
  throw Error("Suno audio exceeds the 50 MB upload limit");
 const type=r.headers.get("content-type")?.split(";")[0].trim().toLowerCase()||"";
 if(type&&!["audio/mpeg","audio/mp3","audio/x-mpeg","application/octet-stream","audio/mpeg3"].includes(type))
  throw Error("Suno did not return an MP3 file");
 const reader=r.body.getReader(),chunks:Uint8Array[]=[];
 let size=0;
 try{
  while(true){
   const part=await reader.read();
   if(part.done)break;
   size+=part.value.byteLength;
   if(size>SUNO_MAX_AUDIO_BYTES)throw Error("Suno audio exceeds the 50 MB upload limit");
   chunks.push(part.value);
  }
 }catch(e){await reader.cancel().catch(()=>{});throw e}
 const bytes=Buffer.concat(chunks);
 // MP3 may begin with ID3 metadata or an MPEG audio frame sync.
 if(bytes.length<1024&&bytes.length===0)throw Error("Suno returned an empty file");
 if(!bytes.subarray(0,3).equals(Buffer.from("ID3"))&&
    !(bytes.length>=2&&bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))
  throw Error("Suno download is not an MP3");
 return bytes;
}
