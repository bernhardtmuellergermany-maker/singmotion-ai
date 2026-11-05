import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit,createAccountMediaSession,revokeMediaSession,session} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {productionCustomerReleaseApproved} from "@/lib/commerce/customer-live-config";
import {applicationOrigin} from "@/lib/request-origin";
export const runtime="nodejs";export const dynamic="force-dynamic";
const accountsEnvironment=()=>process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041" || productionCustomerReleaseApproved(process.env);
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!accountsEnvironment())return json({error:"Accounts unavailable"},403);
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const id=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!id){
   if(process.env.CMS_ENABLED==="true"){
    const {getPayload}=await import("payload");
    const {default:config}=await import("@payload-config");
    const {hasRole}=await import("@/cms/policy");
    const payload=await getPayload({config});
    const {user}=await payload.auth({headers:req.headers});
    if(user && hasRole(user,["super-admin","editor"]))
     return json({authenticated:true,email:typeof user.email==="string"?user.email:"Staff account",kind:"staff"});
   }
   return json({authenticated:false});
  }
  const row=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(id) as {email:string}|undefined;
  return json({authenticated:!!row,email:row?.email||null,kind:"customer"});
 }finally{store.close()}
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!accountsEnvironment()||process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")return json({error:"Accounts not enabled"},503);
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return json({error:"Invalid origin"},403);
 if(Number(req.headers.get("content-length"))>2048)return json({error:"Request too large"},413);
 const raw=await req.text();if(Buffer.byteLength(raw)>2048)return json({error:"Request too large"},413);
 let input:{action?:string;email?:string;password?:string;newPassword?:string};
 try{input=JSON.parse(raw)}catch{return json({error:"Invalid request"},400)}
 // Return a proper 429 rather than an unhandled 500 when signup/login is throttled.
 // Do not trust client-supplied IP headers as an authentication boundary.
 try{
  limit("customer-auth:"+req.headers.get("x-forwarded-for"),8,60000);
  if((input.action==="login"||input.action==="register")&&typeof input.email==="string"){
   const normalized=input.email.trim().toLowerCase();
   if(normalized.length<=254)limit("customer-auth-email:"+normalized,12,15*60000);
  }
 }catch{return json({error:"Too many attempts. Please try again later."},429)}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  if(input.action==="change-password"){
   const oldToken=req.cookies.get("sm_customer")?.value||"";
   const accountId=store.session(oldToken);
   if(!accountId)return json({error:"Customer login required"},401);
   if(typeof input.password!=="string"||typeof input.newPassword!=="string")
    return json({error:"Both passwords required"},400);
   const token=store.changePassword(accountId,input.password,input.newPassword);
   const response=json({changed:true});
   response.cookies.set("sm_customer",token,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400});
   return response;
  }
  if(input.action==="logout"||input.action==="logout-all"){
   const token=req.cookies.get("sm_customer")?.value||"";
   const accountId=store.session(token);
   if(input.action==="logout-all" && !accountId)return json({error:"Customer login required"},401);
   if(input.action==="logout-all" && accountId)store.logoutAll(accountId);
   else if(token)store.logout(token);
   const response=json({authenticated:false});
   response.cookies.delete("sm_customer");
   const media=req.cookies.get("sm_session")?.value;
   if(media && session(media)?.owner.startsWith("customer-"))revokeMediaSession(media);
   const guest=req.cookies.get("sm_guest_session")?.value;
   if(guest && session(guest) && !session(guest)?.owner.startsWith("customer-") && !session(guest)?.owner.startsWith("cms-staff-")){
    response.cookies.set("sm_session",guest,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:30*86400});
    response.cookies.delete("sm_guest_session");
   }else response.cookies.delete("sm_session");
   return response;
  }
  if(!["login","register"].includes(input.action||"")||typeof input.email!=="string"||typeof input.password!=="string")return json({error:"Invalid request"},400);
  if(input.action==="register")store.register(input.email,input.password);
  const token=store.login(input.email,input.password);
  const id=store.session(token);
  if(!id)throw Error("Account session unavailable");
  const media=createAccountMediaSession("customer-"+id);
  const previous=req.cookies.get("sm_session")?.value;
  const previousOwner=session(previous)?.owner;
  const guest=previousOwner && !previousOwner.startsWith("customer-") && !previousOwner.startsWith("cms-staff-") ? previous : null;
  if(previous && previousOwner?.startsWith("customer-"))revokeMediaSession(previous);
  const response=json({authenticated:true,email:input.email.trim().toLowerCase(),owner:media.owner});
  if(guest)response.cookies.set("sm_guest_session",guest,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:30*86400});
  for(const [name,value] of [["sm_customer",token],["sm_session",media.token]]){
   response.cookies.set(name,value,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400});
  }
  return response;
 }catch{return json({error:input.action==="register"?"Registration failed. Check email, password length (20–256), or existing account.":"Invalid credentials"},input.action==="login"?401:400)}
 finally{store.close()}
}