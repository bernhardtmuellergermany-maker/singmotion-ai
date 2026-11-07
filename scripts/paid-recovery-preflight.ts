import {CommerceStore} from "../lib/commerce/store.ts";
import {dataDir} from "../lib/db.ts";
import path from "node:path";

/** Recovery-only worker preflight; no BytePlus network, no payment and no mutation.
 * Explicit execution reports counts, never any customer or task identifiers. */
export function recoveryPreflight(store:CommerceStore){
 const recognized=store.acknowledgedPaidRecovery(100).length;
 const pending=store.pendingPaidFulfillment(100).length;
 return {acknowledgedRecovery:recognized,pendingNotDispatched:pending,
  dispatchEnabled:false,networkRequests:0};
}
if(process.argv[1]?.endsWith("paid-recovery-preflight.ts")){
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{process.stdout.write(JSON.stringify(recoveryPreflight(store))+"\n");}
 finally{store.close()}
}
