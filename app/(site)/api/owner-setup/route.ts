import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { getPayload } from "payload";
import type { PostgresAdapter } from "@payloadcms/db-postgres";
import { sql } from "@payloadcms/db-postgres";
import config from "@payload-config";
import { cmsOriginFailure } from "@/cms/request-security";
import { db, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const respond=(error:string,status:number)=>Response.json({error},{status,headers});
const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const enabled=()=>[STAGING,PRODUCTION].includes(process.env.RAILWAY_ENVIRONMENT_ID||"") &&
  process.env.CMS_ENABLED==="true" && process.env.CMS_OWNER_SETUP_ENABLED==="true" &&
  (process.env.CMS_OWNER_SETUP_TOKEN||"").length>=64;
const recoveryEnabled=()=>process.env.CMS_RECOVERY_ENABLED==="true";
const fingerprint=(token:string)=>createHash("sha256").update(token).digest("hex");
function claimRecoveryToken(token:string):boolean {
  // Only a cryptographic fingerprint is stored; never persist or log secrets.
  db.exec("CREATE TABLE IF NOT EXISTS cms_owner_recovery_claims (fingerprint TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
  return db.prepare("INSERT OR IGNORE INTO cms_owner_recovery_claims (fingerprint,created_at) VALUES (?,?)")
    .run(fingerprint(token),Date.now()).changes===1;
}
export async function GET(req:NextRequest) {
  const denied=stagingDenial(req.headers.get("authorization"));
  if(denied)return denied;
  if(!enabled())return respond("Owner setup is disabled.",404);
  try {
    const payload=await getPayload({config});
    const result=await payload.count({collection:"staff",overrideAccess:true});
    return Response.json({available:result.totalDocs===0,recoveryAvailable:result.totalDocs===1&&recoveryEnabled()},{headers});
  } catch {
    return respond("CMS schema initialization is incomplete.",503);
  }
}
export async function POST(req:NextRequest) {
  const denied=stagingDenial(req.headers.get("authorization"));
  if(denied)return denied;
  if(!enabled())return respond("Owner setup is disabled.",404);
  if(cmsOriginFailure("POST",req.headers,process.env.CMS_ORIGIN))return respond("Invalid request origin.",403);
  try{limit("cms-owner-setup",5,60*60*1000);}catch{return respond("Too many attempts. Try again later.",429);}
  if(Number(req.headers.get("content-length"))>4096)return respond("Request too large.",413);
  let raw:string;
  try {
    raw=await req.text();
    if(Buffer.byteLength(raw)>4096) return respond("Request too large.",413);
  } catch {return respond("Invalid request.",400);}
  let input:unknown;
  try {input=JSON.parse(raw);}catch{return respond("Invalid request.",400);}
  const data=input as {email?:unknown,password?:unknown,setupToken?:unknown};
  if(!data||typeof data.setupToken!=="string"||typeof data.email!=="string"||
     typeof data.password!=="string")return respond("Invalid request.",400);
  const match=(v:string)=>createHash("sha256").update(v).digest();
  const expected=process.env.CMS_OWNER_SETUP_TOKEN!;
  if(data.setupToken.length!==expected.length||
     !timingSafeEqual(match(data.setupToken),match(expected)))
    return respond("Invalid setup token.",403);
  const email=data.email.trim().toLowerCase(),password=data.password;
  if(email.length>320||!/^[^\s@]+@[^\s@]+$/.test(email)||
     password.length<20||password.length>1024||/[\u0000-\u001f\u007f]/.test(password))
    return respond("Enter a valid email and a password of 20–1024 characters.",400);
  const payload=await getPayload({config});
  let id:string|undefined;
  try {
    id=String(await payload.db.beginTransaction() || '') || undefined;
    if(!id)return respond("Database transaction unavailable.",503);
    const session=(payload.db as unknown as PostgresAdapter).sessions[id];
    await session.db.execute(sql`SELECT pg_advisory_xact_lock(73158012)`);
    const txReq={transactionID:id,context:{provisioning:true}};
    const count=await payload.count({collection:"staff",overrideAccess:true,req:txReq});
    if(count.totalDocs===0) {
      await payload.create({
        collection:"staff",overrideAccess:true,req:txReq,
        data:{email,password,role:"super-admin"}
      });
    } else if(count.totalDocs===1 && recoveryEnabled()) {
      const existing=await payload.find({
        collection:"staff",where:{email:{equals:email}},
        overrideAccess:true,depth:0,limit:2,req:txReq
      });
      // Never change another staff member, an editor, or an unknown owner.
      if(existing.docs.length!==1||existing.docs[0].role!=="super-admin"){
        await payload.db.rollbackTransaction(id);id=undefined;
        return respond("Use the email address of the existing Super Admin.",403);
      }
      // Single-use token claim takes place immediately before the change.
      // In case of failure, rotate the recovery token in Railway rather than
      // reopening a consumed credential.
      if(!claimRecoveryToken(expected)){
        await payload.db.rollbackTransaction(id);id=undefined;
        return respond("The recovery code has already been used. Rotate it in Railway.",409);
      }
      await payload.update({
        collection:"staff",id:existing.docs[0].id,overrideAccess:true,req:txReq,
        data:{password,loginAttempts:0,lockUntil:null,sessions:[]}
      });
    } else {
      await payload.db.rollbackTransaction(id);id=undefined;
      return respond("An administrator already exists; recovery is not enabled.",409);
    }
    await payload.db.commitTransaction(id);id=undefined;
    return Response.json({success:true,message:"Super Admin access ready. Sign in via /admin."},{status:201,headers});
  }catch{
    if(id)await payload.db.rollbackTransaction(id).catch(()=>{});
    return respond("Provisioning could not be completed. Verify Production CMS migrations.",503);
  }
}
