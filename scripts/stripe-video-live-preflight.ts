/** Production-only read-only one-time video Stripe audit, separate from Hobby.
 * NEVER sets any approval, charges a card or starts a provider job.
 */
import {readOnlyStripeVideoLivePreflight} from "../lib/commerce/stripe-video-live-preflight.ts";
if(process.argv.length!==3||process.argv[2]!=="--production"){
 console.error("Usage: npm run stripe:video-live-preflight -- --production");
 process.exitCode=2;
}else{
 const result=await readOnlyStripeVideoLivePreflight(process.env);
 for(const item of result.checks)
  console.log((item.ok?"PASS ":"BLOCK ")+item.name);
 console.log("STRIPE_VIDEO_LIVE_PREFLIGHT "+JSON.stringify({
  configurationVerified:result.stripeVideoConfigurationVerified,
  privatePilotApproved:result.privateProductionPilotApproved,
  fulfillmentReady:result.customerFulfillmentReady,
  paidOrdersEnabled:result.paidVideoOrdersEnabled,
  taxRegistrationCount:result.taxRegistrationCount,
  taxAndConsumerReviewStillRequired:true,
  verifiedChecks:result.checks.filter(c=>c.ok).length,
  totalChecks:result.checks.length,
 }));
 if(!result.paidVideoOrdersEnabled)process.exitCode=1;
}
