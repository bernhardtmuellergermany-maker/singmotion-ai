/** Customer payment admission: requires an actually configured bounded worker,
 * validated owner-confirmed price, authenticated customer and private R2 delivery.
 * Staging may accept Stripe TEST money only; Production is a separate rollout.
 */
import {readFileSync} from "node:fs";
import path from "node:path";
import {configuredStripePaymentMode} from "./stripe-payment-mode.ts";
import {productionCustomerReleaseApproved} from "./customer-live-config.ts";
import {customerWorkerEnabled,validateCustomerWorkerPolicy} from "./customer-paid-worker.ts";
import {ownerConfirmedBytePlusPolicy} from "./owner-confirmed-provider-policy.ts";
import {loadBytePlusCredentials} from "../live/signing.ts";
import {loadR2Config} from "../live/r2-config.ts";

export interface CustomerLaunchReadiness{
 readyForPaidOrders:boolean;
 paymentsConnected:boolean;
 accountsEnabled:boolean;
 customerGenerationEnabled:boolean;
 fulfillmentConnected:boolean;
 deliveryConnected:boolean;
 blockers:string[];
}
export function customerLaunchReadiness(env:Record<string,string|undefined>=process.env):CustomerLaunchReadiness{
 const accountsEnabled=env.CUSTOMER_ACCOUNTS_ENABLED==="true";
 const mode=configuredStripePaymentMode(env);
 const paymentsConnected=mode==="test" || (mode==="live"&&productionCustomerReleaseApproved(env));
 const customerGenerationEnabled=customerWorkerEnabled(env)&&
  env.CUSTOMER_GENERATION_ENABLED==="true";
 let fulfillmentConnected=false,deliveryConnected=false;
 if(customerGenerationEnabled&&paymentsConnected){
  try{
   // Fail the whole checkout when any required provider or private R2 secret
   // is missing. This check never sends a charge or provider request.
   if(mode==="live"&&!productionCustomerReleaseApproved(env))
    throw Error("Production customer release not approved");
   const byteplus=loadBytePlusCredentials(env);
   // Avoid treating placeholder strings like "false" or "test" as a configured
   // production provider account. These checks are not proof of authorization.
   if(byteplus.accessKeyId.length<8||byteplus.secretAccessKey.length<16)
    throw Error("BytePlus credentials look like placeholders");
   loadR2Config(env);
   const root=env.DATA_DIR;
   if(!root||!path.isAbsolute(root))throw Error("Private data directory required");
   let policy:unknown;
   try{
    const bytes=readFileSync(path.join(root,"customer-byteplus-policy.json"));
    if(bytes.length<40||bytes.length>65536)throw Error("Invalid private policy");
    policy=JSON.parse(bytes.toString("utf8"));
   }catch(error){
    if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    if(mode!=="test" || env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING!=="true")
     throw Error("Private, approved production provider policy required");
    policy=ownerConfirmedBytePlusPolicy();
   }
   const review=validateCustomerWorkerPolicy(policy);
   fulfillmentConnected=review.dailyCapMicroUsd>0&&review.lifetimeCapMicroUsd>0;
   deliveryConnected=env.CUSTOMER_DELIVERY_ENABLED==="true"&&
    env.CUSTOMER_R2_STORAGE_ENABLED==="true"&&review.contract.outputHosts.length>0;
  }catch{
   // Never leak credentials or policy internals into public readiness response.
  }
 }
 const blockers=[
  ...(!accountsEnabled?["Customer accounts are not enabled."]:[]),
  ...(!paymentsConnected?["A mode-matched Stripe Checkout key, signed webhook and independently approved production release are required."]:[]),
  ...(!customerGenerationEnabled?["Authenticated, bounded customer worker is not enabled for this payment environment."]:[]),
  ...(!fulfillmentConnected?["Reviewed owner-confirmed BytePlus pricing, private media and provider credentials are unavailable."]:[]),
  ...(!deliveryConnected?["Private R2 output delivery is not enabled."]:[]),
 ];
 return {readyForPaidOrders:blockers.length===0,paymentsConnected,
  accountsEnabled,customerGenerationEnabled,fulfillmentConnected,deliveryConnected,blockers};
}
