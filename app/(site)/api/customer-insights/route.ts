import {NextRequest,NextResponse} from "next/server";
import {getPayload} from "payload";
import config from "@payload-config";
import {hasRole} from "@/cms/policy";
import {stagingDenial} from "@/lib/staging";
import {limit,dataDir} from "@/lib/db";
import {storageOverview} from "@/lib/music-video/storage";
import {
 listCustomerInsights,customerInsightProfile,openCustomerInsightsReadOnly,
} from "@/lib/commerce/customer-insights";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const responseHeaders={
 "Cache-Control":"private, no-store, max-age=0","Vary":"Cookie",
 "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
 "X-Robots-Tag":"noindex, nofollow, noarchive",
};
const reply=(payload:unknown,status=200)=>NextResponse.json(payload,{status,headers:responseHeaders});

/**
 * Read-only and restricted to an actual authenticated CMS Super Admin.
 * Customer sessions, support roles, editors and guest users have no access.
 * Every successful view is recorded in the protected CMS audit collection.
 */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));
 if(denied)return denied;
 if(process.env.CMS_ENABLED!=="true")return reply({error:"Unavailable"},404);
 try{
  const payload=await getPayload({config});
  const {user}=await payload.auth({headers:req.headers});
  if(!hasRole(user,["super-admin"]))return reply({error:"Super Admin required"},403);
  const actor=String(user?.id||"");
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(actor))return reply({error:"Access denied"},403);
  try{limit("customer-insights:"+actor,90,60_000)}
  catch{return reply({error:"Too many requests"},429)}
  if(req.nextUrl.searchParams.get("storage")==="1"){
   const storage=storageOverview(dataDir);
   await payload.create({collection:"audit-events",overrideAccess:true,data:{actor,action:"view",resource:"customer-insights",record:"storage"}});
   return reply({storage});
  }
  const id=req.nextUrl.searchParams.get("id");
  const search=req.nextUrl.searchParams.get("q")||"";
  const pageString=req.nextUrl.searchParams.get("page")||"1";
  if(search.length>80 || (id!==null&&!/^[a-f0-9-]{36}$/i.test(id)) ||
   !/^\d{1,5}$/.test(pageString)||Number(pageString)>10000||Number(pageString)<1)
    return reply({error:"Invalid search"},400);
  const db=openCustomerInsightsReadOnly(dataDir);
  let body:unknown;
  try{
   if(id!==null){
    const profile=customerInsightProfile(db,id);
    if(!profile)return reply({error:"Customer not found"},404);
    body={profile};
   }else{
    body=listCustomerInsights(db,{search,page:Number(pageString)});
   }
  }finally{db.close()}
  // Fail closed if a sensitive read cannot be recorded in the CMS audit.
  await payload.create({collection:"audit-events",overrideAccess:true,data:{
   actor,action:"view",resource:"customer-insights",record:id||"list",
  }});
  return reply(body);
 }catch{
  return reply({error:"Private customer insights temporarily unavailable"},503);
 }
}
