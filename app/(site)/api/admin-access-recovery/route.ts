import {createHash,timingSafeEqual} from "node:crypto";
import {NextRequest} from "next/server";
import {getPayload} from "payload";
import config from "@payload-config";
import {cmsOriginFailure} from "@/cms/request-security";
import {stagingDenial} from "@/lib/staging";
import {db,limit} from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const respond=(message:string,status=200)=>Response.json({message},{status,headers});
function enabled(){
 const env=process.env;
 return (env.RAILWAY_ENVIRONMENT_ID===STAGING||env.RAILWAY_ENVIRONMENT_ID===PRODUCTION)&&
  env.CMS_ENABLED==="true"&&env.CMS_ADMIN_RECOVERY_ENABLED==="true"&&
  env.CMS_RECOVERY_ENABLED==="true"&&
  (env.CMS_ADMIN_RECOVERY_TOKEN||"").length>=64;
}
const digest=(value:string)=>createHash("sha256").update(value).digest();
function tokenUsed(hash:string){
 db.exec("CREATE TABLE IF NOT EXISTS cms_admin_recovery_used(hash TEXT PRIMARY KEY,used_at INTEGER NOT NULL)");
 return !!db.prepare("SELECT 1 FROM cms_admin_recovery_used WHERE hash=?").get(hash);
}
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!enabled())return respond("Recovery currently unavailable.",404);
 return respond("Recovery available. Use the separate Railway secret for this environment.");
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!enabled())return respond("Recovery currently unavailable.",404);
 if(cmsOriginFailure("POST",req.headers,process.env.CMS_ORIGIN))return respond("Invalid request origin.",403);
 try{limit("cms:admin-recovery",5,60*60*1000);}catch{return respond("Too many attempts. Try again later.",429);}
 if(Number(req.headers.get("content-length")||0)>4096)return respond("Request too large.",413);
 let data:unknown;
 try{const body=await req.text();if(Buffer.byteLength(body)>4096)return respond("Request too large.",413);data=JSON.parse(body);}catch{return respond("Invalid request.",400);}
 if(!data||typeof data!=="object")return respond("Invalid request.",400);
 const {email,password,recoveryToken}=data as {email?:unknown;password?:unknown;recoveryToken?:unknown};
 if(typeof email!=="string"||typeof password!=="string"||typeof recoveryToken!=="string")return respond("All fields required.",400);
 const normalized=email.trim().toLowerCase();
 if(normalized.length>320||!/^[^\s@]+@[^\s@]+$/.test(normalized)||
    password.length<20||password.length>1024||/[\u0000-\u001f\u007f]/.test(password))return respond("Enter a valid email and password of at least 20 characters.",400);
 const secret=process.env.CMS_ADMIN_RECOVERY_TOKEN||"";
 if(recoveryToken.length!==secret.length||!timingSafeEqual(digest(recoveryToken),digest(secret)))return respond("Invalid recovery code.",403);
 const hash=digest(secret).toString("hex");
 if(tokenUsed(hash))return respond("This recovery code has already been used.",409);
 try{
  const payload=await getPayload({config});
  const found=await payload.find({collection:"staff",where:{email:{equals:normalized}},limit:2,depth:0,overrideAccess:true});
  if(found.docs.length>1)return respond("Account data requires administrator review.",409);
  if(found.docs.length===1){
   const account=found.docs[0];
   if(account.role!=="super-admin")return respond("Only an existing Super Admin can be recovered.",403);
   await payload.update({collection:"staff",id:account.id,overrideAccess:true,data:{password,loginAttempts:0,lockUntil:null}});
  }else{
   const count=await payload.count({collection:"staff",overrideAccess:true});
   if(count.totalDocs!==0)return respond("Use the email address of the existing Super Admin.",409);
   // The initial account can only be created if the staff collection is empty,
   // with the exact provisioning context required by the CMS role policy.
   await payload.create({collection:"staff",overrideAccess:true,req:{context:{provisioning:true}} as never,
    data:{email:normalized,password,role:"super-admin"}});
  }
  db.prepare("INSERT OR IGNORE INTO cms_admin_recovery_used(hash,used_at) VALUES(?,?)").run(hash,Date.now());
  return respond("Administrator access ready. Sign in under /admin.");
 }catch(error){
  console.error("CMS_ADMIN_RECOVERY_FAILED",error instanceof Error?error.name:"unknown");
  return respond("Recovery could not be completed. Existing data was preserved.",503);
 }
}