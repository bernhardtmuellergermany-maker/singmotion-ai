/** Explicit, non-mutating production-only check.
 * No API credentials, IDs, account numbers or customer data are printed.
 */
import {readOnlyStripeLivePreflight} from "../lib/commerce/stripe-live-preflight.ts";
if(process.argv.length!==3||process.argv[2]!=="--production"){
 console.error("Usage: npm run stripe:live-preflight -- --production");
 process.exitCode=2;
}else{
 const result=await readOnlyStripeLivePreflight(process.env);
 for(const {name,ok} of result.checks) console.log((ok?"PASS ":"BLOCK ")+name);
 console.log("STRIPE_LIVE_PREFLIGHT "+JSON.stringify({
  verified:result.stripeConfigurationVerified,
  paidOrdersEnabled:result.paidOrdersEnabled,
  passed:result.checks.filter(c=>c.ok).length,total:result.checks.length,
 }));
 if(!result.paidOrdersEnabled)process.exitCode=1;
}
