/** Exactly one signed OmniHuman GetResult on a random never-submitted ID.
 * Auth/connectivity evidence only; never submits, cancels, charges or unlocks
 * customer checkout. The result is redacted to an operational status token.
 */
import {randomUUID} from "node:crypto";
import {wireRequest,type Transport} from "../lib/live/byteplus.ts";
import {createSignedTransport,BytePlusTransportError} from "../lib/live/signed-transport.ts";
import {loadBytePlusCredentials} from "../lib/live/signing.ts";

const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
export type BytePlusProbeStatus="skipped"|"verified_readonly"|"provider_rejected"|"authentication_failed"|"blocked"|`provider_rejected_code_${number}`;

export async function readonlyBytePlusAccessProbe(
 env:Record<string,string|undefined>=process.env,
 transport?:Transport,
):Promise<BytePlusProbeStatus>{
 const production=env.RAILWAY_ENVIRONMENT_ID===PRODUCTION;
 const staging=env.RAILWAY_ENVIRONMENT_ID===STAGING;
 if((!production&&!staging)||
    env.BYTEPLUS_READONLY_ACCESS_PREFLIGHT_ENABLED!=="true"||
    env.STAGING_AUTH_ENABLED!=="true"||
    (env.STAGING_PASSWORD?.length||0)<32||
    (production&&(env.PRODUCTION_PUBLIC_ACCESS_ENABLED!=="false"||
     env.PUBLIC_CUSTOMER_LAUNCH_APPROVED!=="false"||
     env.STRIPE_LIVE_CHECKOUT_ENABLED!=="false"||
     env.CUSTOMER_PAID_WORKER_ENABLED!=="false"||
     env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED!=="false")))
   return "skipped";
 let creds:ReturnType<typeof loadBytePlusCredentials>;
 try{creds=loadBytePlusCredentials(env)}catch{return "blocked"}
 // Never use a real task ID. No SubmitTask or CancelTask is reachable here.
 const req=wireRequest("CVSync2AsyncGetResult",{
  task_id:"singmotion-probe-never-submitted-"+randomUUID(),
 });
 const requestTransport=transport??createSignedTransport(fetch,()=>creds,()=>new Date(),12000);
 try{
  // BytePlus documents 50500/50501 as transient internal failures. Retry only
  // this read-only GetResult once, with the SAME synthetic non-customer task ID.
  // No submit/cancel/recharge or unknown task recovery is attempted here.
  let response=await requestTransport(req,AbortSignal.timeout(17000));
  const firstCode=(response.body&&typeof response.body==="object"&&!Array.isArray(response.body))
    ? (response.body as Record<string,unknown>).code : null;
  if((firstCode===50500||firstCode==="50500"||firstCode===50501||firstCode==="50501")&&
      (response.status===500||response.status===200)) {
    response=await requestTransport(req,AbortSignal.timeout(17000));
  }
  const payload=response.body;
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return "provider_rejected";
  const obj=payload as Record<string,unknown>;
  const rawCode=obj.code;
  const code=typeof rawCode==="number"&&Number.isSafeInteger(rawCode)?rawCode:
    typeof rawCode==="string"&&/^[0-9]{1,6}$/.test(rawCode)?Number(rawCode):null;
  // BytePlus's documented task-not-found status is data.status=not_found
  // with top-level code 10000. Code 50510 is a risk/content-filter error,
  // NOT proof of authentication (see OmniHuman service error tables).
  // A random never-submitted task must never be interpreted as 50510 success.
  const data=obj.data&&typeof obj.data==="object"&&!Array.isArray(obj.data)?
    obj.data as Record<string,unknown>:null;
  if(code===10000&&response.status===200&&data?.status==="not_found")
    return "verified_readonly";
  if(response.status===401||response.status===403||code===50401||code===50403)
    return "authentication_failed";
  // Numeric code only: no BytePlus message, raw payload or credentials.
  if(code!==null&&code>=0&&code<=999999)
    return `provider_rejected_code_${code}`;
  return "provider_rejected";
 }catch(error){
  if(error instanceof BytePlusTransportError&&error.kind==="authentication")return "authentication_failed";
  return "blocked";
 }
}
