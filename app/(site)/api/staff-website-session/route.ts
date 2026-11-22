import {NextRequest} from "next/server";
import {getPayload} from "payload";
import payloadConfig from "@payload-config";
import {hasRole} from "@/cms/policy";
import {stagingDenial} from "@/lib/staging";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
/** Read-only identity display, never a customer or Studio authorization.
 * The restricted CMS token is independently checked on every request.
 */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041"||process.env.CMS_ENABLED!=="true")
  return Response.json({authenticated:false},{status:404,headers});
 try{
  const cms=await getPayload({config:payloadConfig});
  const {user}=await cms.auth({headers:req.headers});
  if(!hasRole(user,["super-admin"]))return Response.json({authenticated:false},{headers});
  return Response.json({authenticated:true,kind:"staff",staffRole:"super-admin",
   email:typeof user?.email==="string"?user.email:"CMS Super Admin"},{headers});
 }catch{return Response.json({authenticated:false,error:"CMS session unavailable"},{status:503,headers});}
}
