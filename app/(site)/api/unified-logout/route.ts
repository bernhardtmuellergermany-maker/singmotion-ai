import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,session,revokeMediaSession,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";

/** One browser = one authenticated principal.
 * Clearing both HTTP-only auth cookies immediately signs all tabs out. Revoking
 * customer & media sessions also invalidates any reused private workspace token.
 * Payload staff tokens are removed from the browser (the staff session table is
 * not modified; CMS administrators can manage global device sessions there).
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
 if(customerToken){
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{store.logout(customerToken)}finally{store.close()}
 }
 const media=req.cookies.get("sm_session")?.value;
 if(media&&session(media))revokeMediaSession(media);
 const response=NextResponse.json({signedOut:true},{headers:{"Cache-Control":"no-store","Clear-Site-Data":""}});
 response.cookies.delete("sm_customer");
 response.cookies.delete("sm_session");
 response.cookies.delete("payload-token");
 return response;
}
