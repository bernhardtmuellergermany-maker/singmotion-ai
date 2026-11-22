import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {ReferralProgram} from "@/lib/commerce/referral-program";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest,{params}:{params:Promise<{code:string}>}){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const {code}=await params;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 let accepted=false;
 try{accepted=new ReferralProgram(store.db).accepts(code);}
 finally{store.close();}
 const target=new URL("/login",req.url);
 const response=NextResponse.redirect(target,{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"}});
 if(accepted)response.cookies.set("sm_referral",code,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:14*86400});
 return response;
}
