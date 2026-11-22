import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,session,revokeMediaSession,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {siteStaffStatus} from "@/lib/site-staff-auth";

/** Logout the verified account shown on the website.
 * A customer logout preserves a separate CMS login, but a staff-only logout
 * must clear its CMS credential or the next status check logs staff back in.
 */
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)
  return NextResponse.json({error:"Invalid origin"},{status:403});
 try{limit("unified-logout",40,60000)}catch{return NextResponse.json({error:"Too many requests"},{status:429})}
 const customerToken=req.cookies.get("sm_customer")?.value||"";
 let authenticatedCustomer=false;
 if(customerToken){
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   authenticatedCustomer=!!store.session(customerToken);
   if(authenticatedCustomer)store.logout(customerToken);
  }finally{store.close()}
 }
 const staff=!authenticatedCustomer?await siteStaffStatus(req.headers):null;
 const media=req.cookies.get("sm_session")?.value;
 const mediaOwner=media?session(media)?.owner:null;
 const response=NextResponse.json({signedOut:true},{headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});
 if(authenticatedCustomer){
  // When both identities exist, customer wins. Never clear CMS credentials.
  if(media&&mediaOwner?.startsWith("customer-"))revokeMediaSession(media);
  response.cookies.delete("sm_customer");
  if(mediaOwner?.startsWith("customer-"))response.cookies.delete("sm_session");
 }else if(staff){
  // Staff login on this site uses the original Payload session. Clearing it
  // also signs the user out of CMS, not just the website.
  if(media&&mediaOwner?.startsWith("cms-staff-"))revokeMediaSession(media);
  response.cookies.set("payload-token","",{
   httpOnly:true,secure:origin.startsWith("https://"),sameSite:"strict",
   path:"/",maxAge:0
  });
  if(mediaOwner?.startsWith("cms-staff-"))response.cookies.delete("sm_session");
  // Clear expired/dangling customer cookies without affecting a real login.
  response.cookies.delete("sm_customer");
 }else{
  if(media&&mediaOwner&&!mediaOwner.startsWith("cms-staff-"))revokeMediaSession(media);
  response.cookies.delete("sm_customer");
  if(!mediaOwner?.startsWith("cms-staff-"))response.cookies.delete("sm_session");
 }
 return response;
}
