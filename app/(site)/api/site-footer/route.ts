import {getPayload} from "payload";
import config from "@payload-config";
import {safeLink} from "@/cms/policy";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 try{
  if(process.env.CMS_ENABLED!=="true")return Response.json({links:[]});
  const payload=await getPayload({config});
  const global=await payload.findGlobal({slug:"site-navigation",overrideAccess:true,depth:0});
  const raw=(global as unknown as {footer?:{links?:{label?:string;url?:string}[]}}).footer?.links;
  const links=Array.isArray(raw)?raw.filter(x=>typeof x?.label==="string"&&x.label.trim()&&typeof x?.url==="string"&&safeLink(x.url)).slice(0,12).map(x=>({label:x.label!.trim().slice(0,80),url:x.url!})):[];
  return Response.json({links},{headers:{"Cache-Control":"no-store"}});
 }catch(error){console.error("CMS footer unavailable",error);return Response.json({links:[]},{headers:{"Cache-Control":"no-store"}});}
}
