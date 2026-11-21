import {hasRole} from "@/cms/policy";

/** Private, unreleased Projects feature.
 * A customer cookie or an accidentally enabled customer rollout flag
 * must NEVER grant access to pages or any music-video API operation.
 * Super Admin CMS authentication is a separate, server-verified session.
 */
export async function musicPrincipal(headers:Headers,_customerToken:string):Promise<string|null>{
  if(process.env.CMS_ENABLED!=="true")return null;
  const {getPayload}=await import("payload");
  const {default:config}=await import("@payload-config");
  const payload=await getPayload({config});
  const {user}=await payload.auth({headers});
  if(!hasRole(user,["super-admin"]))return null;
  const id=String((user as {id:unknown}).id);
  return /^[A-Za-z0-9_-]{1,100}$/.test(id)?"staff:"+id:null;
}
