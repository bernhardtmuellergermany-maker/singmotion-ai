import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";

test("newly enabled paid customer worker never dispatches historical sandbox orders",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=store.order({account:null,email:"historic@example.test",project:"old-sandbox-order",
   cents:125,quoteEvidence:"historical-reviewed-quote-2026",key:"historic-order-activation"}).id;
  store.bindStripeCheckout(id,"cs_test_historic_01");
  await store.webhook(new Uint8Array(),"signed",{async verify(){return {
   provider:"stripe",eventId:"evt_historic_01",orderId:id,cents:125,
   currency:"EUR" as const,evidence:"cs_test_historic_01",
  }}});
  const historical=Date.now()-60_000;
  store.db.prepare("UPDATE customer_fulfillment_queue SET created=? WHERE order_id=?").run(historical,id);
  assert.deepEqual(store.pendingPaidFulfillment(),[id]);
  assert.deepEqual(store.pendingPaidFulfillmentSince(Date.now()-1000),[]);
  assert.deepEqual(store.pendingPaidFulfillmentSince(historical-1),[id]);
  assert.equal(store.paidProviderJob(id),null);
  assert.equal(store.paidSubmissionStatus(id),null);
 }finally{store.close()}
});
test("activation must be finite, positive and not in the future",()=>{
 const store=new CommerceStore(":memory:");
 try{
  for(const value of [0,-1,NaN,Infinity,Date.now()+30000])
   assert.throws(()=>store.pendingPaidFulfillmentSince(value),/cutoff/);
 }finally{store.close()}
});
