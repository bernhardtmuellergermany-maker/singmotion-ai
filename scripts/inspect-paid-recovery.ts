import {CommerceStore} from "../lib/commerce/store.ts";
import {dataDir} from "../lib/db.ts";
import path from "node:path";

/** Operator-only, read-only, no network or provider dispatch. Never prints
 * account IDs, order IDs, email, job IDs, URLs or private media paths. */
export function inspectRecoveryCounts(store:CommerceStore){
 const count=(sql:string)=>Number((store.db.prepare(sql).get() as {n:number}).n);
 return {
  awaitingPayment:count("SELECT COUNT(*) AS n FROM customer_orders WHERE status='awaiting_payment'"),
  paidPending:count("SELECT COUNT(*) AS n FROM customer_fulfillment_queue q JOIN customer_orders o ON o.id=q.order_id WHERE q.state='pending' AND o.status='paid'"),
  acknowledgedRecovery:store.acknowledgedPaidRecovery(100).length,
  ambiguousProcessing:count("SELECT COUNT(*) AS n FROM customer_fulfillment_queue q JOIN customer_orders o ON o.id=q.order_id LEFT JOIN customer_provider_jobs j ON j.order_id=q.order_id WHERE q.state='processing' AND o.status='paid' AND j.order_id IS NULL"),
  delivered:count("SELECT COUNT(*) AS n FROM customer_fulfillment_queue WHERE state='delivered'"),
  failed:count("SELECT COUNT(*) AS n FROM customer_fulfillment_queue WHERE state='failed'"),
 };
}
if(process.argv[1]?.endsWith("inspect-paid-recovery.ts")){
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{process.stdout.write(JSON.stringify(inspectRecoveryCounts(store))+"\n");}
 finally{store.close();}
}
