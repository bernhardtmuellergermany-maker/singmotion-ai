import { test } from "node:test";
import assert from "node:assert/strict";
import { CommerceStore, type VerifiedPayment } from "../lib/commerce/store.ts";
import { PlanLedger } from "../lib/commerce/plans.ts";
import { stripeCheckoutAdapter } from "../lib/commerce/stripe-webhook.ts";
import { createHmac } from "node:crypto";

const order = (store: CommerceStore, key: string) => store.order({
  account: null, email: "buyer@example.test", project: "project-" + key,
  cents: 1250, quoteEvidence: "reviewed-quote-evidence-2026", key,
}).id;
const receipt = (orderId: string, eventId = "evt_test_1", evidence = "cs_test_order1"): VerifiedPayment => ({
  orderId, eventId, evidence, cents: 1250, provider: "stripe", currency: "EUR",
});
const deliver = (store: CommerceStore, r: VerifiedPayment) =>
  store.webhook(new Uint8Array(), "signed", { async verify() { return r; } });

test("Stripe payments require exact server-bound Checkout Session", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = order(store, "session-binding-1");
    await assert.rejects(deliver(store, receipt(id)), /Session/);
    store.bindStripeCheckout(id, "cs_test_order1");
    store.bindStripeCheckout(id, "cs_test_order1");
    assert.throws(() => store.bindStripeCheckout(id, "cs_test_other"), /conflict/);
    await assert.rejects(deliver(store, receipt(id, "evt_wrong", "cs_test_other")), /Session/);
    assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status, "awaiting_payment");
  } finally { store.close(); }
});

test("Stripe signed receipt marks the matched order paid exactly once", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = order(store, "session-binding-2");
    store.bindStripeCheckout(id, "cs_test_order1");
    const payment = receipt(id);
    await deliver(store, payment);
    await deliver(store, payment);
    const status = store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id);
    assert.equal(status?.status, "paid");
    const events = store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get();
    assert.equal(events?.n, 1);
    const queued = store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id);
    assert.equal(queued?.state, "pending");
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n, 1);
    await deliver(store, receipt(id, "evt_second"));
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()?.n, 2);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n, 1);
    await assert.rejects(deliver(store, {...payment, cents: 1200}), /Conflicting/);
  } finally { store.close(); }
});

test("Stripe cannot pay a different order using another order's Checkout Session", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const first = order(store, "session-binding-3");
    const second = order(store, "session-binding-4");
    store.bindStripeCheckout(first, "cs_test_first");
    store.bindStripeCheckout(second, "cs_test_second");
    await assert.rejects(deliver(store, receipt(second, "evt_mismatch", "cs_test_first")), /Session/);
    assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(second)?.status, "awaiting_payment");
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n, 0);
  } finally { store.close(); }
});

test("paid fulfillment may be claimed only once and is never auto-reclaimed", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = order(store, "single-fulfillment-claim");
    assert.equal(store.claimPaidFulfillment(id), false);
    store.bindStripeCheckout(id, "cs_test_once");
    await deliver(store, receipt(id, "evt_paid_once", "cs_test_once"));
    assert.equal(store.claimPaidFulfillment(id), true);
    assert.equal(store.claimPaidFulfillment(id), false);
    assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state, "processing");
  } finally { store.close(); }
});

test("paid fulfillment terminal states require evidence, are one-way and do not retry", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = order(store, "fulfilled-terminal-state");
    assert.throws(() => store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"verified-output-reference-123456"}), /provider job/);
    store.bindStripeCheckout(id, "cs_test_completed");
    await deliver(store, receipt(id, "evt_completed", "cs_test_completed"));
    assert.throws(() => store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"short"}), /evidence/);
    assert.equal(store.claimPaidFulfillment(id), true);
    assert.throws(() => store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"verified-output-reference-123456"}), /provider job/);
    assert.equal(store.beginPaidProviderSubmission(id), true);
    assert.equal(store.recordPaidProviderJob(id, "byteplus", "task-test-delivered"), true);
    assert.throws(() => store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"verified-output-reference-123456"}), /private video delivery/);
    assert.equal(store.recordPaidVideoDelivery(id,"private_video_asset_123456","validated-private-asset-reference-123456"),true);
    assert.equal(store.recordPaidVideoDelivery(id,"private_video_asset_123456","validated-private-asset-reference-123456"),false);
    assert.throws(() => store.recordPaidVideoDelivery(id,"private_video_asset_changed","validated-private-asset-reference-123456"),/conflict/);
    assert.equal(store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"verified-output-reference-123456"}), true);
    assert.equal(store.finalizePaidFulfillment(id, {state:"failed",failureEvidence:"later-provider-error-123456789"}), false);
    assert.equal(store.claimPaidFulfillment(id), false);
    assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state, "delivered");
  } finally {store.close();}
});
test("failed fulfillment cannot be automatically claimed again", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = order(store, "failed-terminal-state");
    store.bindStripeCheckout(id, "cs_test_failed");
    await deliver(store, receipt(id, "evt_failed", "cs_test_failed"));
    assert.equal(store.claimPaidFulfillment(id), true);
    assert.equal(store.finalizePaidFulfillment(id, {state:"failed",failureEvidence:"diagnostic-reference-123456789"}), true);
    assert.equal(store.claimPaidFulfillment(id), false);
  } finally {store.close();}
});

test("worker discovery returns only paid pending jobs and never dispatches them", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const unpaid = order(store, "discovery-unpaid");
    const first = order(store, "discovery-first");
    const second = order(store, "discovery-second");
    store.bindStripeCheckout(first, "cs_test_discovery_first");
    store.bindStripeCheckout(second, "cs_test_discovery_second");
    await deliver(store, receipt(first, "evt_discovery_first", "cs_test_discovery_first"));
    await deliver(store, receipt(second, "evt_discovery_second", "cs_test_discovery_second"));
    assert.deepEqual([...store.pendingPaidFulfillment()].sort(), [first, second].sort());
    assert.equal(store.pendingPaidFulfillment(1).length, 1);
    assert.throws(() => store.pendingPaidFulfillment(0), /batch size/);
    assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(unpaid)?.status, "awaiting_payment");
    assert.equal(store.claimPaidFulfillment(first), true);
    assert.deepEqual(store.pendingPaidFulfillment(), [second]);
    assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(second)?.state, "pending");
  } finally { store.close(); }
});

test("provider job reference is unique, immutable and requires paid exclusive claim", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const first = order(store, "provider-job-first");
    const second = order(store, "provider-job-second");
    assert.throws(() => store.recordPaidProviderJob(first, "byteplus", "task-123"), /barrier/);
    store.bindStripeCheckout(first,"cs_test_job_first");
    store.bindStripeCheckout(second,"cs_test_job_second");
    await deliver(store,receipt(first,"evt_job_first","cs_test_job_first"));
    await deliver(store,receipt(second,"evt_job_second","cs_test_job_second"));
    assert.throws(() => store.recordPaidProviderJob(first,"byteplus","task-123"), /barrier/);
    assert.equal(store.claimPaidFulfillment(first),true);
    assert.throws(() => store.recordPaidProviderJob(first,"byteplus","task-123"), /barrier/);
    assert.equal(store.beginPaidProviderSubmission(first),true);
    assert.equal(store.beginPaidProviderSubmission(first),false);
    assert.equal(store.paidSubmissionStatus(first),"submitted_or_unknown");
    assert.equal(store.recordPaidProviderJob(first,"byteplus","task-123"),true);
    assert.equal(store.paidSubmissionStatus(first),"acknowledged");
    assert.deepEqual(store.paidProviderJob(first),{provider:"byteplus",jobId:"task-123"});
    assert.equal(store.recordPaidProviderJob(first,"byteplus","task-123"),false);
    assert.throws(() => store.recordPaidProviderJob(first,"byteplus","task-456"), /conflict/);
    assert.equal(store.claimPaidFulfillment(second),true);
    assert.equal(store.beginPaidProviderSubmission(second),true);
    assert.throws(() => store.recordPaidProviderJob(second,"byteplus","task-123"), /UNIQUE/);
    assert.equal(store.paidProviderJob(second),null);
    assert.equal(store.claimPaidFulfillment(first),false);
  } finally { store.close(); }
});

test("unknown BytePlus submission after network timeout stays permanently blocked", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = order(store, "unknown-submission");
    store.bindStripeCheckout(id,"cs_test_unknown");
    await deliver(store,receipt(id,"evt_unknown","cs_test_unknown"));
    assert.throws(() => store.beginPaidProviderSubmission(id),/claim/);
    assert.equal(store.claimPaidFulfillment(id),true);
    assert.equal(store.beginPaidProviderSubmission(id),true);
    assert.equal(store.paidSubmissionStatus(id),"submitted_or_unknown");
    assert.equal(store.beginPaidProviderSubmission(id),false);
    assert.equal(store.claimPaidFulfillment(id),false);
    assert.equal(store.paidProviderJob(id),null);
  } finally {store.close();}
});

test("delivered video asset is visible only to its authorized guest", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const created = store.order({
      account: null, email: "viewer@example.test", project: "viewer-project",
      cents: 1250, quoteEvidence: "reviewed-quote-evidence-2026", key: "owner-delivery-access",
    });
    const id = created.id;
    const token = created.guestToken;
    assert.ok(token);
    assert.throws(() => store.ownedDeliveredVideoAsset(id,null,"wrong-guest-token"), /unavailable/);
    assert.equal(store.ownedDeliveredVideoAsset(id,null,token!),null);
    store.bindStripeCheckout(id,"cs_test_delivered_owner");
    await deliver(store,receipt(id,"evt_delivered_owner","cs_test_delivered_owner"));
    assert.equal(store.claimPaidFulfillment(id),true);
    assert.equal(store.beginPaidProviderSubmission(id),true);
    assert.equal(store.recordPaidProviderJob(id,"byteplus","task-owner-access"),true);
    assert.equal(store.recordPaidVideoDelivery(id,"private_video_ownership_001","validated-private-video-ownership-001"),true);
    assert.equal(store.ownedDeliveredVideoAsset(id,null,token!),null);
    assert.equal(store.finalizePaidFulfillment(id,{state:"delivered",deliveryEvidence:"private-video-delivery-complete-001"}),true);
    assert.equal(store.ownedDeliveredVideoAsset(id,null,token!),"private_video_ownership_001");
    assert.throws(() => store.ownedDeliveredVideoAsset(id,null,"wrong-guest-token"), /unavailable/);
  } finally {store.close();}
});

test("reviewed customer video inputs are immutable and bound before payment", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = order(store, "reviewed-inputs");
    const inputDigest = "a".repeat(64);
    const reviewDigest = "b".repeat(64);
    assert.throws(() => store.bindReviewedOrderInputs(id, "bad", reviewDigest), /digest/);
    assert.equal(store.bindReviewedOrderInputs(id, inputDigest, reviewDigest), true);
    assert.equal(store.bindReviewedOrderInputs(id, inputDigest, reviewDigest), false);
    assert.throws(() => store.bindReviewedOrderInputs(id, "c".repeat(64), reviewDigest), /conflict/);
    store.bindStripeCheckout(id, "cs_test_reviewed");
    await deliver(store, receipt(id, "evt_reviewed", "cs_test_reviewed"));
    assert.throws(() => store.bindReviewedOrderInputs(id, inputDigest, reviewDigest), /awaiting payment/);
    assert.equal(store.db.prepare("SELECT input_digest FROM customer_order_inputs WHERE order_id=?").get(id)?.input_digest, inputDigest);
  } finally { store.close(); }
});

test("Stripe rejects a mismatched reserved split quote before marking an order paid",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"split-project",cents:250,quoteEvidence:"reviewed-quote-evidence-2026",key:"split-test-01"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  store.bindStripeCheckout(id,"cs_test_split");
  store.db.prepare("UPDATE customer_split_quotes SET extra_cents=200 WHERE attempt_id=?").run(id);
  await assert.rejects(deliver(store,{...receipt(id,"evt_split","cs_test_split"),cents:250}) ,/reservation mismatch/);
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"awaiting_payment");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()?.n,0);
  store.db.prepare("UPDATE customer_split_quotes SET extra_cents=250 WHERE attempt_id=?").run(id);
  await deliver(store,{...receipt(id,"evt_split","cs_test_split"),cents:250});
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"paid");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n,1);
 }finally{store.close()}
});

test("another signed Stripe event after consumed Hobby allowance never enqueues twice", async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"hobby-overage",
   cents:250,quoteEvidence:"reviewed-quote-evidence-2026",key:"hobby-settled-001"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  store.bindStripeCheckout(id,"cs_test_settled");
  const paid={...receipt(id,"evt_settled_1","cs_test_settled"),cents:250};
  await deliver(store,paid);
  ledger.settleSplitQuote(id,"consumed");
  await deliver(store,{...paid,eventId:"evt_settled_2"});
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()?.n,2);
 }finally{store.close()}
});

test("verified delivery atomically consumes reserved Hobby seconds",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"hobby-delivery",
    cents:250,quoteEvidence:"reviewed-quote-evidence-2026",key:"hobby-delivery-01"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  store.bindStripeCheckout(id,"cs_test_hobbydelivery");
  await deliver(store,{...receipt(id,"evt_hobbydelivery","cs_test_hobbydelivery"),cents:250});
  assert.equal(store.claimPaidFulfillment(id),true);
  assert.equal(store.beginPaidProviderSubmission(id),true);
  assert.equal(store.recordPaidProviderJob(id,"byteplus","task-hobby-delivery"),true);
  assert.equal(store.recordPaidVideoDelivery(id,"hobby_private_asset_001","verified-hobby-private-asset-evidence"),true);
  assert.equal(store.finalizePaidFulfillment(id,{state:"delivered",deliveryEvidence:"private-delivery-verified-001"}),true);
  assert.equal((store.db.prepare("SELECT state FROM customer_split_quotes WHERE attempt_id=?").get(id) as {state:string}).state,"consumed");
  assert.equal(store.finalizePaidFulfillment(id,{state:"delivered",deliveryEvidence:"private-delivery-verified-001"}),false);
 }finally{store.close()}
});

test("unstarted customer order cancellation releases reserved seconds only once",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"cancelled-order",
    cents:250,quoteEvidence:"reviewed-quote-evidence-2026",key:"cancel-order-test-01"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  assert.equal(store.cancelUnstartedCustomerOrder(id,account),true);
  assert.equal(store.cancelUnstartedCustomerOrder(id,account),false);
  assert.equal((store.db.prepare("SELECT state FROM customer_split_quotes WHERE attempt_id=?").get(id) as {state:string}).state,"released");
  assert.equal((store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id) as {status:string}).status,"cancelled");
 }finally{store.close()}
});
test("an opened Stripe Checkout prevents unsafe allowance release",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"checkout-started",
    cents:250,quoteEvidence:"reviewed-quote-evidence-2026",key:"checkout-started-01"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  store.bindStripeCheckout(id,"cs_test_safety");
  assert.throws(()=>store.cancelUnstartedCustomerOrder(id,account),/reconciliation/);
  assert.equal((store.db.prepare("SELECT state FROM customer_split_quotes WHERE attempt_id=?").get(id) as {state:string}).state,"reserved");
 }finally{store.close()}
});

test("verified full Stripe refund before provider claim releases reserved allowance once",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"refundable-song",cents:250,quoteEvidence:"reviewed-refund-evidence-2026",key:"refund-order-123"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  store.bindStripeCheckout(id,"cs_test_refundable");
  await deliver(store,{...receipt(id,"evt_refundable","cs_test_refundable"),cents:250});
  const proof={orderId:id,stripeCheckoutId:"cs_test_refundable",refundId:"re_test_refundable",refundedCents:250,evidence:"stripe-refund-verified-by-trusted-worker"};
  assert.throws(()=>store.reconcileVerifiedStripeRefund({...proof,refundedCents:200}),/mismatch/);
  assert.equal(store.reconcileVerifiedStripeRefund(proof),true);
  assert.equal(store.reconcileVerifiedStripeRefund(proof),false);
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"refunded");
  assert.equal(store.db.prepare("SELECT state FROM customer_split_quotes WHERE attempt_id=?").get(id)?.state,"released");
  assert.equal(store.claimPaidFulfillment(id),false);
  await deliver(store,{...receipt(id,"evt_refund_replay","cs_test_refundable"),cents:250});
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.n,1);
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state,"failed");
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"refunded");
 }finally{store.close()}
});
test("refund after paid worker claim requires manual reconciliation",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=order(store,"claimed-refund");
  store.bindStripeCheckout(id,"cs_test_claimed");
  await deliver(store,receipt(id,"evt_claimed","cs_test_claimed"));
  assert.equal(store.claimPaidFulfillment(id),true);
  assert.throws(()=>store.reconcileVerifiedStripeRefund({orderId:id,stripeCheckoutId:"cs_test_claimed",refundId:"re_test_claimed",refundedCents:1250,evidence:"stripe-refund-verified-by-trusted-worker"}),/manual provider reconciliation/);
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"paid");
 }finally{store.close()}
});

test("verified dispute blocks pending fulfillment without releasing Hobby quota",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"disputed-song",cents:250,
   quoteEvidence:"reviewed-dispute-evidence-2026",key:"dispute-order-001"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  store.bindStripeCheckout(id,"cs_test_disputed");
  await deliver(store,{...receipt(id,"evt_disputed","cs_test_disputed"),cents:250});
  const proof={orderId:id,stripeCheckoutId:"cs_test_disputed",disputeId:"dp_test_disputed",evidence:"verified-card-dispute-source-record"};
  assert.equal(store.reconcileVerifiedStripeDispute(proof),true);
  assert.equal(store.reconcileVerifiedStripeDispute(proof),false);
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"disputed");
  assert.equal(store.db.prepare("SELECT state FROM customer_split_quotes WHERE attempt_id=?").get(id)?.state,"reserved");
  assert.equal(store.claimPaidFulfillment(id),false);
  await deliver(store,{...receipt(id,"evt_after_dispute","cs_test_disputed"),cents:250});
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"disputed");
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state,"failed");
 }finally{store.close()}
});

test("signed sandbox checkout, reserved overage, verified refund, and delayed event reconcile end to end offline",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account="11111111-1111-4111-8111-111111111111";
  const id=store.order({account,email:"buyer@example.test",project:"sandbox-flow",
    cents:250,quoteEvidence:"reviewed-sandbox-flow-evidence-2026",key:"signed-sandbox-flow-001"}).id;
  const ledger=new PlanLedger(store.db);
  ledger.reserveSplitQuote(account,id,10);
  store.bindStripeCheckout(id,"cs_test_offline_flow");
  const secret="whsec_offline_test_secret";
  async function signed(eventId:string){
   const event={id:eventId,type:"checkout.session.completed",livemode:false,
    data:{object:{object:"checkout.session",id:"cs_test_offline_flow",mode:"payment",
      payment_status:"paid",currency:"eur",amount_total:250,metadata:{orderId:id}}}};
   const raw=Buffer.from(JSON.stringify(event)),timestamp=String(Math.floor(Date.now()/1000));
   const signature="t="+timestamp+",v1="+createHmac("sha256",secret).update(Buffer.concat([Buffer.from(timestamp+"."),raw])).digest("hex");
   await store.webhook(raw,signature,stripeCheckoutAdapter(secret));
  }
  await signed("evt_offline_flow_paid");
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state,"pending");
  const proof={orderId:id,stripeCheckoutId:"cs_test_offline_flow",refundId:"re_test_offline_flow",
    refundedCents:250,evidence:"independently-verified-sandbox-refund-test"};
  assert.equal(store.reconcileVerifiedStripeRefund(proof),true);
  await signed("evt_offline_flow_delayed");
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"refunded");
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state,"failed");
  assert.equal(store.db.prepare("SELECT state FROM customer_split_quotes WHERE attempt_id=?").get(id)?.state,"released");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n,1);
 }finally{store.close()}
});
