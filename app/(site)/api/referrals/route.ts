import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {ReferralProgram} from "@/lib/commerce/referral-program";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const id=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!id)return NextResponse.json({enabled:false},{headers:{"Cache-Control":"private, no-store"}});
  limit("referral-self:"+id,30,60000);
  const program=new ReferralProgram(store.db);
  return NextResponse.json(program.customerView(id),{headers:{"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"}});
 }catch{return NextResponse.json({enabled:false},{headers:{"Cache-Control":"private, no-store"}});}
 finally{store.close();}
}
