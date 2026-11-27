import {hasRole} from "@/cms/policy";
import {projectR2Enabled} from "./project-r2";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir} from "@/lib/db";
import path from "node:path";

/** Experimental Projects: verified customer sessions require the explicit rollout flag and verified private R2 storage. */
export async function musicPrincipal(headers:Headers,customerToken:string):Promise<string|null>{
  // A valid customer session always takes precedence over an independent CMS cookie.
  if(customerToken){
    const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
    try{
      const id=store.session(customerToken);
      if(id){
        // Separate explicit rollout gate: deployment does not enable customers.
        if(process.env.MUSIC_VIDEO_CUSTOMER_ENABLED==="true"&&projectR2Enabled()&&store.emailVerified(id)&&/^[a-f0-9-]{36}$/i.test(id))return "customer:"+id;
        return null;
      }
    }finally{store.close();}
  }
  if(process.env.CMS_ENABLED!=="true")return null;
  const {getPayload}=await import("payload");
  const {default:config}=await import("@payload-config");
  const payload=await getPayload({config});
  const {user}=await payload.auth({headers});
  if(!hasRole(user,["super-admin"]))return null;
  const id=String((user as {id:unknown}).id);
  return /^[A-Za-z0-9_-]{1,100}$/.test(id)?"staff:"+id:null;
}
