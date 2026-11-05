/** Optional, zero-write Production R2 connectivity preflight.
 * HEAD bucket only: no objects uploaded, no customer media, no BytePlus calls,
 * no Stripe charges. Never prints credentials, hostnames or bucket names.
 */
import {HeadBucketCommand,S3Client} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "../lib/live/r2-config.ts";

const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export type R2ReadOnlyPreflightStatus="skipped"|"verified"|"blocked";
export async function productionR2ReadOnlyPreflight(
 env:Record<string,string|undefined>=process.env,
 send?: (command:HeadBucketCommand)=>Promise<unknown>,
):Promise<R2ReadOnlyPreflightStatus>{
 // A read-only credential test is not a production release approval.
 // Refuse to run when actual public payments or provider dispatch are enabled.
 if(env.RAILWAY_ENVIRONMENT_ID!==PRODUCTION||
    env.PRODUCTION_R2_READONLY_PREFLIGHT_ENABLED!=="true"||
    env.STRIPE_LIVE_CHECKOUT_ENABLED!=="false"||
    env.PUBLIC_CUSTOMER_LAUNCH_APPROVED!=="false"||
    env.CUSTOMER_PAID_WORKER_ENABLED!=="false"||
    env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED!=="false")
  return "skipped";
 let client:S3Client|undefined;
 try{
  const cfg=loadR2Config(env);
  if(!send){
   client=new S3Client(r2ClientConfig(cfg));
   send=(command)=>client!.send(command,{abortSignal:AbortSignal.timeout(8000)});
  }
  await send(new HeadBucketCommand({Bucket:cfg.bucket}));
  return "verified";
 }catch{
  // Deliberately do not expose provider errors: they may contain secrets,
  // signed headers, endpoint URLs or account identifiers.
  return "blocked";
 }finally{client?.destroy()}
}
