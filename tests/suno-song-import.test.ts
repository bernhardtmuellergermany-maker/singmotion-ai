import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeSunoSongLink} from "../lib/suno-song-link.ts";
import {sunoProductionOnly,pkcePair,authorizationUrl,oauthClientRegistration,sunoReturnUrl,sunoReturnDestination,
 SUNO_APP_ORIGIN,signSunoAccessToken,verifySunoAccessToken,isAllowedSunoDownloadUrl,
 extractSunoSongId,resolveSunoSongId,sunoMcpDownload,downloadAuthorizedSunoMp3}
 from "../lib/suno-mcp-import.ts";

const sample="9NgKJGqKoraKou62",id="abcdef01-2345-6789-abcd-001122334455";
const wizard=readFileSync(new URL("../components/studio-wizard.tsx",import.meta.url),"utf8");
const ui=readFileSync(new URL("../components/suno-song-import.tsx",import.meta.url),"utf8");
const api=readFileSync(new URL("../app/(site)/api/suno-import/route.ts",import.meta.url),"utf8");
const callback=readFileSync(new URL("../app/(site)/api/suno-import/callback/route.ts",import.meta.url),"utf8");

test("only the approved Railway Production environment can enable Suno import",()=>{
 assert.equal(sunoProductionOnly({RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"}),true);
 assert.equal(sunoProductionOnly({RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"}),false);
 assert.equal(sunoProductionOnly({}),false);
 for(const code of [api,callback])assert.match(code,/sunoProductionOnly\(\)/);
});
test("Suno share and canonical links are normalized and untrusted targets are rejected",()=>{
 assert.equal(normalizeSunoSongLink("https://suno.com/s/"+sample),"https://suno.com/s/"+sample);
 assert.equal(normalizeSunoSongLink("https://www.suno.com/s/"+sample+"/?x=1#foo"),"https://suno.com/s/"+sample);
 assert.equal(extractSunoSongId("https://suno.com/song/"+id),id);
 for(const value of ["http://suno.com/s/"+sample,"https://suno.com.evil.net/s/"+sample,
 "https://evil.net/s/"+sample,"https://suno.com@evil.net/s/"+sample,
 "https://suno.com/api/clip/"+sample,"https://suno.com/s/%2F%2Fevil.net",
 "https://cdn1.suno.ai/"+id+".mp3","javascript:alert(1)",
 "https://suno.com:1337/s/"+sample,"https://suno.com/song/bad"]){
  assert.equal(normalizeSunoSongLink(value),null,value);
 }
});
test("share link resolves only through Suno's own normal HTTP redirect",async()=>{
 const redirects:typeof fetch=async (_input,init)=>{
  assert.equal(init?.method,"HEAD");
  return new Response(null,{status:302,headers:{Location:"https://suno.com/song/"+id+"?sh=1"}});
 };
 assert.equal(await resolveSunoSongId("https://suno.com/s/"+sample,redirects),id);
 const hostile:typeof fetch=async()=>new Response(null,{status:302,headers:{Location:"https://evil.net/song/"+id}});
 assert.equal(await resolveSunoSongId("https://suno.com/s/"+sample,hostile),null);
 assert.equal(await resolveSunoSongId("https://suno.com/song/"+id,hostile),id);
});
test("OAuth PKCE uses random state, narrow capabilities, and the own callback URL",()=>{
 const one=pkcePair(),two=pkcePair();
 assert.notEqual(one.state,two.state);assert.notEqual(one.verifier,two.verifier);
 const uri=authorizationUrl("client-id-123",SUNO_APP_ORIGIN+"/api/suno-import/callback",one);
 const parsed=new URL(uri);
 assert.equal(parsed.searchParams.get("code_challenge_method"),"S256");
 assert.notEqual(parsed.searchParams.get("code_challenge"),one.verifier);
 assert.equal(parsed.searchParams.get("resource"),"https://api.suno.com/mcp");
 assert.equal(parsed.searchParams.get("scope")?.includes("credits:spend"),false);
 assert.equal(oauthClientRegistration(SUNO_APP_ORIGIN+"/api/suno-import/callback").token_endpoint_auth_method,"none");
});
test("Suno OAuth access is time-limited and cryptographically bound to the original private session",()=>{
 const mediaToken="a".repeat(75);
 const bound=signSunoAccessToken(mediaToken,"customer-abc","some-suno-oauth-access-token",900);
 assert.ok(bound.ttl<=780);
 assert.equal(verifySunoAccessToken(bound.cookie,mediaToken,"customer-abc"),"some-suno-oauth-access-token");
 assert.equal(verifySunoAccessToken(bound.cookie,"b".repeat(75),"customer-abc"),null);
 assert.equal(verifySunoAccessToken(bound.cookie,mediaToken,"customer-other"),null);
 assert.equal(verifySunoAccessToken(bound.cookie,mediaToken,"customer-abc",Date.now()+20*60*1000),null);
 assert.equal(verifySunoAccessToken(bound.cookie.slice(0,-2)+"ab",mediaToken,"customer-abc"),null);
});
test("MCP first checks download entitlement, then requires explicit one-credit consent",async()=>{
 let calls:Record<string,unknown>[]=[];
 const mock:typeof fetch=async (url,init)=>{
  assert.equal(String(url),"https://api.suno.com/mcp");
  const body=JSON.parse(String(init?.body)) as {method:string;params?:Record<string,unknown>};
  calls.push(body);
  if(body.method==="initialize")return Response.json({jsonrpc:"2.0",id:1,result:{protocolVersion:"2025-06-18"}});
  if(body.method==="notifications/initialized")return new Response(null,{status:202});
  if(body.method==="tools/call")return Response.json({jsonrpc:"2.0",id:1,
   result:{content:[{type:"text",text:JSON.stringify({status:"requires_credit"})}]}});
  throw Error("unexpected RPC");
 };
 const first=await sunoMcpDownload("user-authorization",id,false,mock);
 assert.equal(first.status,"requires_credit");
 assert.deepEqual((calls.at(-1)?.params as {arguments:object}).arguments,{id,format:"mp3"});
 calls=[];
 await sunoMcpDownload("user-authorization",id,true,mock);
 assert.deepEqual((calls.at(-1)?.params as {arguments:object}).arguments,{id,format:"mp3",confirm:true});
});
test("download accepts only provider-controlled HTTPS hosts and bounded MP3 payloads",async()=>{
 assert.equal(isAllowedSunoDownloadUrl("https://cdn-o.suno.com/file.mp3"),true);
 assert.equal(isAllowedSunoDownloadUrl("https://cdn1.suno.ai/file.mp3"),true);
 assert.equal(isAllowedSunoDownloadUrl("https://suno-data-uploads.s3.amazonaws.com/studio/uploads/song.mp3?Signature=redacted"),true);
 assert.equal(isAllowedSunoDownloadUrl("https://other-bucket.s3.amazonaws.com/song.mp3"),false);
 assert.equal(isAllowedSunoDownloadUrl("https://suno-data-uploads.s3.amazonaws.com.evil.net/song.mp3"),false);
 assert.equal(isAllowedSunoDownloadUrl("http://suno-data-uploads.s3.amazonaws.com/song.mp3"),false);
 for(const url of ["http://cdn1.suno.ai/file.mp3","https://suno.com.evil.net/file.mp3",
  "https://localhost/file.mp3","https://127.0.0.1/file.mp3","https://cdn1.suno.ai:8080/file.mp3"]){
  assert.equal(isAllowedSunoDownloadUrl(url),false,url);
 }
 const bytes=new Uint8Array(2048);bytes.set([73,68,51]);
 const mock:typeof fetch=async()=>new Response(bytes,{headers:{"content-type":"audio/mpeg"}});
 const content=await downloadAuthorizedSunoMp3("https://cdn-o.suno.com/file.mp3",mock);
 assert.equal(content.byteLength,2048);
 const oversized:typeof fetch=async()=>new Response(bytes,{headers:{"content-length":String(50*1024*1024+1)}});
 await assert.rejects(downloadAuthorizedSunoMp3("https://cdn-o.suno.com/file.mp3",oversized),/50 MB/);
});
test("unapproved MCP download hosts are rejected and diagnostics never expose signed URLs",async()=>{
 const hostileUrl="https://downloads.example.net/private/song.mp3?signature=secret-value&token=very-sensitive";
 const originalWarn=console.warn;
 const warnings:unknown[][]=[];
 console.warn=(...args:unknown[])=>{warnings.push(args)};
 try{
  const mock:typeof fetch=async (_url,init)=>{
   const body=JSON.parse(String(init?.body)) as {method:string};
   if(body.method==="initialize")return Response.json({jsonrpc:"2.0",id:1,result:{protocolVersion:"2025-06-18"}});
   if(body.method==="notifications/initialized")return new Response(null,{status:202});
   return Response.json({jsonrpc:"2.0",id:1,result:{structuredContent:{status:"ready",url:hostileUrl}}});
  };
  await assert.rejects(sunoMcpDownload("user-authorization",id,true,mock),/unapproved audio download host/);
  assert.equal(warnings.length,1);
  const diagnostic=JSON.stringify(warnings);
  assert.ok(diagnostic.includes("downloads.example.net"));
  for(const secret of ["secret-value","very-sensitive","signature","private/song"]){
   assert.ok(!diagnostic.includes(secret));
  }
 }finally{console.warn=originalWarn}
});
test("Suno OAuth return opens direct import, confirms connection, and excludes manual fallback",()=>{
 assert.match(callback,/sunoReturnUrl\(saved\?\.destination,error\)/);
 assert.match(ui,/setExpanded\(true\)/);
 assert.match(ui,/suno_connected/);
 assert.match(ui,/focusAfterConnect/);
 assert.match(ui,/linkInput\.current\?\.focus\(\)/);
 assert.match(ui,/Suno connected — ready to import your song/);
 assert.match(ui,/open=\{expanded\}/);
 assert.doesNotMatch(ui,/Choose downloaded audio|Or download the song through Suno|FileMusic|onChooseFile/);
 assert.doesNotMatch(wizard,/onChooseFile=\{\(\)=>audioFileInput/);
 assert.match(ui,/Import song directly/);
});
test("Suno disconnect only clears the scoped OAuth cookies after authentication and origin checks",()=>{
 assert.match(api,/export async function DELETE\(req:NextRequest\)/);
 assert.match(api,/req\.headers\.get\("origin"\)!==SUNO_APP_ORIGIN/);
 assert.match(api,/if\(!session\(mediaToken\)\)/);
 assert.match(api,/response\.cookies\.set\("sm_suno_access",""/);
 assert.match(api,/response\.cookies\.set\("sm_suno_oauth",""/);
 assert.match(api,/path:"\/api\/suno-import",maxAge:0/);
 assert.doesNotMatch(api,/response\.cookies\.set\("sm_session"/);
 assert.match(ui,/method:"DELETE"/);
 assert.match(ui,/setConnected\(false\)/);
 assert.match(ui,/className=\{styles\.disconnect\}/);
 assert.match(ui,/disabled=\{disabled\|\|working\}/);
});
test("Studio integrates direct official download into the existing validated private audio upload",()=>{
 assert.match(wizard,/onImportFile=\{importSunoAsNewDraft\}/);
 assert.match(wizard,/uploadWithProgress\(file, kind,/);
 assert.match(ui,/Import song directly/);
 assert.match(ui,/Connect Suno to import/);
 assert.match(ui,/Confirm 1 Suno download credit/);
 assert.match(ui,/new File\(\[blob\],name/);
 assert.match(api,/downloadAuthorizedSunoMp3/);
 assert.match(api,/sunoMcpDownload/);
 assert.match(api,/req.headers.get\("origin"\)!==SUNO_APP_ORIGIN/);
 assert.match(api,/session\(mediaToken\)/);
 assert.doesNotMatch(ui,/cdn1\.suno\.ai|stream-rip|window\.open\(.*cdn/);
});

test("Suno import uses the local brand logo and concise copy",()=>{
 assert.match(ui,/suno-uploaded-logo/);
 assert.doesNotMatch(ui,/src="\/suno-mark\.svg"/);
 assert.doesNotMatch(ui,/Connection successful\. Paste your Suno song link below/);
 assert.match(ui,/setNotice\(""\); \/\/ The connected status banner/);
 assert.match(ui,/className=\{styles\.srOnly\} htmlFor=\{id\}>Suno song link<\/label>/);
 assert.doesNotMatch(ui,/className=\{styles\.label\} htmlFor=\{id\}>Suno song link/);
 assert.match(ui,/Paste a Suno share link/);
 assert.doesNotMatch(ui,/no manual MP3 download/);
 assert.doesNotMatch(ui,/Connect your own Suno account to import a song directly/);
 assert.doesNotMatch(ui,/Suno may charge one of your download credits for a first-time download/);
 assert.doesNotMatch(ui,/<Music2/);
 assert.match(ui,/Confirm 1 Suno download credit & import/);
 assert.match(ui,/Disconnect/);
});

test("importing Suno from a signed-in workspace resets state in place, not by reopening a previous draft",()=>{
 assert.match(wizard,/onImportFile=\{importSunoAsNewDraft\}/);
 const isolated=wizard.split("async function importSunoAsNewDraft")[1].split("async function add(")[0];
 assert.match(isolated,/uploadWithProgress\(file, "audio"/);
 assert.match(isolated,/if \(asset.kind !== "audio" \|\| typeof asset.id !== "string" \|\| !asset.id\)/);
 assert.doesNotMatch(isolated,/asset\.owner/);
 assert.match(isolated,/const newId = crypto\.randomUUID\(\)/);
 assert.match(isolated,/const fresh = \{ \.\.\.initial, song: asset, start: 0/);
 assert.match(isolated,/draftId\.current = newId/);
 assert.match(isolated,/setProjectKey\(newId\)/);
 assert.match(isolated,/setDraft\(fresh\)/);
 assert.match(isolated,/setStep\(0\)/);
 assert.match(isolated,/setTimeline\(\[\]\)/);
 assert.match(isolated,/setProjectName\(new Date\(\)/);
 assert.match(isolated,/setImageReady\(false\)/);
 assert.match(isolated,/setReviewRights\(false\)/);
 assert.match(isolated,/setGenerationProjectId\(""\)/);
 assert.match(isolated,/setSaved\(false\)/);
 assert.match(isolated,/firstDraftSave\.current = true/);
 assert.match(isolated,/sessionStorage\.setItem\("singmotion-home-audio-handoff"/);
 assert.match(isolated,/window\.history\.replaceState\(window\.history\.state, "", "\/studio\?new=1&audio=1"\)/);
 assert.doesNotMatch(isolated,/window\.location\.assign\(/);
 assert.doesNotMatch(isolated,/update\(\{/);
 assert.match(isolated,/throw Error\(message\)/);
});
test("new intent survives remounts until its own owner-scoped draft saves, never selecting the last Step 4",()=>{
 assert.match(wizard,/const createNew = params\.get\("new"\) === "1" && !requested && !copy/);
 assert.match(wizard,/createNew \|\| copy \|\| ownerChanged/);
 assert.doesNotMatch(wizard,/song\.owner === sessionOwner/);
 assert.match(wizard,/if \(!createNew\) window\.history\.replaceState\(window\.history\.state, "", "\/studio"\)/);
 assert.match(wizard,/draftId\.current === id/);
 assert.match(wizard,/location\.searchParams\.get\("new"\) === "1"/);
 assert.match(wizard,/window\.history\.replaceState\(window\.history\.state, "", "\/studio\?draft=" \+ encodeURIComponent\(id\)\)/);
 assert.match(wizard,/sessionStorage\.removeItem\("singmotion-home-audio-handoff"\)/);
});

test("Projects Suno return is same-origin and strictly allowlisted",()=>{
 assert.equal(sunoReturnUrl("projects"),SUNO_APP_ORIGIN+"/projects?suno_connected=1");
 assert.equal(sunoReturnUrl("projects","cancelled"),SUNO_APP_ORIGIN+"/projects?suno_error=cancelled");
 assert.equal(sunoReturnDestination("https://evil.example"),"studio");
 assert.equal(sunoReturnUrl("//evil.example"),SUNO_APP_ORIGIN+"/studio?new=1&suno_connected=1");
 const projects=readFileSync(new URL("../components/music-projects-client.tsx",import.meta.url),"utf8");
 assert.ok(projects.includes('destination="projects"'));
 assert.ok(projects.includes("onImportFile={async file=>{setSong(file);}}"));
 assert.ok(projects.includes('body.set("song",song)'));
});
