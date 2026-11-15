import {
 assessPrivateProductionCreditVideo,PRODUCTION_CREDIT_VIDEO_ACCEPTANCE
} from "../lib/commerce/private-production-credit-readiness.ts";

if(process.argv.length!==3||process.argv[2]!=="--private-production") {
 console.error("Usage: node --experimental-strip-types scripts/credit-video-production-preflight.ts --private-production");
 process.exitCode=2;
} else {
 const report=assessPrivateProductionCreditVideo(process.env);
 for(const check of report.checks) {
  console.log(`${check.ready?"PASS":"BLOCK"} ${check.id}`);
 }
 console.log("MANUAL_ACCEPTANCE_REQUIRED (not inferred from configuration):");
 for(const label of PRODUCTION_CREDIT_VIDEO_ACCEPTANCE)console.log(`VERIFY ${label}`);
 console.log(`PRIVATE_CREDIT_VIDEO_PREFLIGHT ${JSON.stringify({
  configurationReady:report.configurationReady,
  acceptanceVerifiedByThisScript:false,
  publicReleaseApproved:false,
 })}`);
 if(!report.configurationReady)process.exitCode=1;
}
