import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {applicationOrigin} from "./request-origin.ts";

/** Existing CMS staff credentials, reused by the existing public login form.
 * Never select a role from the submitted email; only a verified Payload staff
 * record with an explicit role grants CMS privileges.
 */
export async function siteStaffStatus(headers:Headers):Promise<{
 authenticated:true;kind:"staff";staffRole:"super-admin"|"editor";email:string
}|null>{
 if(process.env.CMS_ENABLED!=="true")return null;
 try{
  const {getPayload}=await import("payload");
  const {default:config}=await import("@payload-config");
  const {hasRole}=await import("@/cms/policy");
  const payload=await getPayload({config});
  const {user}=await payload.auth({headers});
  if(!user||!hasRole(user,["super-admin","editor"])||
    typeof user.email!=="string")return null;
  return {authenticated:true,kind:"staff",
   staffRole:hasRole(user,["super-admin"])?"super-admin":"editor",
   email:user.email};
 }catch{return null}
}

/** A CMS password is attempted only when the ordinary customer login failed.
 * The CMS token is scoped to the same verified site, never sent in JSON.
 * CMS sessions, roles, password policies and audit hooks stay authoritative.
 */
export async function tryExistingSuperAdminLogin(req:NextRequest,email:string,password:string):Promise<NextResponse|null>{
 if(process.env.CMS_ENABLED!=="true"||!process.env.CMS_ORIGIN)return null;
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||origin!==process.env.CMS_ORIGIN||req.headers.get("origin")!==origin)return null;
 try{
  const {getPayload}=await import("payload");
  const {default:config}=await import("@payload-config");
  const {hasRole}=await import("@/cms/policy");
  const payload=await getPayload({config});
  const result=await payload.login({collection:"staff",data:{email,password}});
  if(!result.user||!hasRole(result.user,["super-admin"])||typeof result.token!=="string"||
     result.token.length<20)return null;
  const response=NextResponse.json({
   authenticated:true,kind:"staff",staffRole:"super-admin",email:result.user.email
  },{headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});
  response.cookies.set("payload-token",result.token,{
   httpOnly:true,secure:new URL(origin).protocol==="https:",sameSite:"strict",
   path:"/",maxAge:3600
  });
  return response;
 }catch{return null}
}
