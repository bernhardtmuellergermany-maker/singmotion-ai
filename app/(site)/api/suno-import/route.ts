import {NextRequest,NextResponse} from "next/server";
import {stagingDenial} from "@/lib/staging";
import {session,limit} from "@/lib/db";
import {SUNO_APP_ORIGIN,sunoProductionOnly,verifySunoAccessToken,
 resolveSunoSongId,sunoMcpDownload,downloadAuthorizedSunoMp3} from "@/lib/suno-mcp-import";
import {normalizeSunoSongLink} from "@/lib/suno-song-link";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
function authenticated(req:NextRequest){
 const mediaToken=req.cookies.get("sm_session")?.value||"";
 const account=session(mediaToken);
 if(!account)return {owner:"",token:null};
 return {owner:account.owner,token:verifySunoAccessToken(
  req.cookies.get("sm_suno_access")?.value,mediaToken,account.owner)};
}
function gate(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!sunoProductionOnly()||req.headers.get("host")!=="www.singmotion.ai")
  return json({error:"Suno import is not available on this environment."},404);
 return null;
}
export async function GET(req:NextRequest){
 const denied=gate(req);if(denied)return denied;
 const {owner,token}=authenticated(req);
 return json({connected:!!owner&&!!token});
}
export async function DELETE(req:NextRequest){
 const denied=gate(req);if(denied)return denied;
 if(req.headers.get("origin")!==SUNO_APP_ORIGIN)
  return json({error:"Request origin not allowed."},403);
 const mediaToken=req.cookies.get("sm_session")?.value||"";
 if(!session(mediaToken))return json({error:"Sign in to disconnect Suno."},401);
 const response=json({connected:false,message:"Suno disconnected."});
 response.cookies.set("sm_suno_access","",{httpOnly:true,secure:true,sameSite:"strict",
  path:"/api/suno-import",maxAge:0});
 response.cookies.set("sm_suno_oauth","",{httpOnly:true,secure:true,sameSite:"lax",
  path:"/api/suno-import",maxAge:0});
 return response;
}

export async function POST(req:NextRequest){
 const denied=gate(req);if(denied)return denied;
 if(req.headers.get("origin")!==SUNO_APP_ORIGIN)return json({error:"Request origin not allowed."},403);
 const {owner,token}=authenticated(req);
 if(!owner||!token)return json({status:"connect_required",error:"Connect your Suno account first."},401);
 const length=Number(req.headers.get("content-length")||0);
 if(length>1800)return json({error:"Request too large."},413);
 let body:{link?:unknown;confirmCredit?:unknown};
 try{const raw=await req.text();if(raw.length>1200)throw Error();body=JSON.parse(raw)}
 catch{return json({error:"Invalid import request."},400)}
 const link=typeof body.link==="string"?normalizeSunoSongLink(body.link):null;
 if(!link)return json({error:"Paste a valid Suno song share link."},400);
 try{
  limit("suno-import:"+owner,12,10*60*1000);
  // Share-shortlinks are resolved only by Suno's normal redirect; no scraping.
  const id=await resolveSunoSongId(link);
  if(!id)return json({status:"full_link_required",
   error:"Suno did not resolve this short link to a song ID. Open the song in Suno and copy its full suno.com/song/... address."},422);
  const grant=await sunoMcpDownload(token,id,body.confirmCredit===true);
  if(grant.status==="requires_credit")return json({status:"requires_credit",
   message:"Suno requires one download credit for this song. Confirm only if you want to spend it."});
  if(grant.status==="processing")return json({status:"processing",
   message:"Suno is preparing the official MP3. Select Import again shortly."});
  const bytes=await downloadAuthorizedSunoMp3(grant.url);
  const filename="suno-"+id+".mp3";
  return new Response(new Uint8Array(bytes),{status:200,headers:{...headers,
   "Content-Type":"audio/mpeg","Content-Length":String(bytes.byteLength),
   "Content-Disposition":'attachment; filename="'+filename+'"',
   "X-Suno-Audio-Filename":filename}});
 }catch(e){
  if(e instanceof Error&&/Too many|rate limit|limit exceeded/i.test(e.message))
   return json({error:"Too many Suno imports. Try again later."},429);
  return json({error:e instanceof Error&&
   (/Suno|audio exceeds|MP3|short link|song|provider|50 MB/.test(e.message))
   ?e.message:"Suno import is temporarily unavailable."},422);
 }
}
