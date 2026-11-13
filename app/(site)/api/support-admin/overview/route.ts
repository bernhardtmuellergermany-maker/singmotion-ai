import {NextRequest} from "next/server";
import path from "node:path";
import {getPayload} from "payload";
import config from "@payload-config";
import {adminTestOwner} from "@/cms/first-test";
import {CommerceStore} from "@/lib/commerce/store";
import {SupportCases} from "@/lib/commerce/support-cases";
import {adminSupportOverview} from "@/lib/commerce/admin-support-overview";
import {stagingDenial} from "@/lib/staging";
import {dataDir,limit} from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={
 "Cache-Control":"private, no-store",
 "X-Content-Type-Options":"nosniff",
 "Referrer-Policy":"no-referrer",
 "Vary":"Cookie",
};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers});

/** Status messages are private to an authenticated Payload CMS Super Admin.
 * Neither customer cookies nor the account-settings UI grant authorization. */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));
 if(denied)return denied;
 if(process.env.CMS_ENABLED!=="true")return json({error:"Admin status unavailable"},503);
 let actor:string;
 try{
  const payload=await getPayload({config});
  const {user}=await payload.auth({headers:req.headers});
  actor=adminTestOwner(user,"GET",req.headers,process.env);
 }catch{
  return json({error:"Super Admin authorization required"},403);
 }
 let store:CommerceStore|undefined;
 try{
  limit("admin-support-overview:"+actor,20,60000);
  store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  new SupportCases(store.db); // initialize idempotent status tables when empty
  return json({overview:adminSupportOverview(store.db,process.env)});
 }catch{
  // No private DB details, provider task IDs, customer emails or credentials.
  return json({error:"Support status temporarily unavailable"},503);
 }finally{store?.close()}
}
