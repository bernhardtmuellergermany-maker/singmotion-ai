import {hasRole} from "@/cms/policy";
import {dataDir} from "@/lib/db";
import {CommerceStore} from "@/lib/commerce/store";
import path from "node:path";

/** Single principal resolver shared by page rendering and all music-video APIs.
 * Staff editors may not inherit a stale customer cookie. Future customer
 * release is controlled by an explicit server-side feature flag.
 */
export async function musicPrincipal(headers:Headers,customerToken:string):Promise<string|null>{
  if(process.env.CMS_ENABLED==="true"){
    const {getPayload}=await import("payload");
    const {default:config}=await import("@payload-config");
    const payload=await getPayload({config});
    const {user}=await payload.auth({headers});
    if(hasRole(user,["super-admin"])){
      const id=String((user as {id:unknown}).id);
      return /^[A-Za-z0-9_-]{1,100}$/.test(id)?"staff:"+id:null;
    }
    if(hasRole(user,["editor"]))return null;
  }
  if(process.env.MUSIC_VIDEO_CUSTOMER_ENABLED!=="true" ||
     process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true" || !customerToken)return null;
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
    const id=store.session(customerToken);
    return id&&/^[a-f0-9-]{36}$/.test(id)?"customer:"+id:null;
  }finally{store.close();}
}
