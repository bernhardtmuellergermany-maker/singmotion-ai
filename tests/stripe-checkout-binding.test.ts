import { test } from "node:test";
import assert from "node:assert/strict";
import { CommerceStore, type VerifiedPayment } from "../lib/commerce/store.ts";

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
    await assert.rejects(deliver(store, receipt(id, "evt_second")), /reconciliation/);
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
    assert.equal(store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"verified-output-reference-123456"}), false);
    store.bindStripeCheckout(id, "cs_test_completed");
    await deliver(store, receipt(id, "evt_completed", "cs_test_completed"));
    assert.throws(() => store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"short"}), /evidence/);
    assert.equal(store.claimPaidFulfillment(id), true);
    assert.throws(() => store.finalizePaidFulfillment(id, {state:"delivered",deliveryEvidence:"verified-output-reference-123456"}), /provider job/);
    assert.equal(store.beginPaidProviderSubmission(id), true);
    assert.equal(store.recordPaidProviderJob(id, "byteplus", "task-test-delivered"), true);
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
    assert.deepEqual(store.pendingPaidFulfillment(), [first, second]);
    assert.deepEqual(store.pendingPaidFulfillment(1), [first]);
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
    assert.throws(() => store.recordPaidProviderJob(first, "byteplus", "task-123"), /claim/);
    store.bindStripeCheckout(first,"cs_test_job_first");
    store.bindStripeCheckout(second,"cs_test_job_second");
    await deliver(store,receipt(first,"evt_job_first","cs_test_job_first"));
    await deliver(store,receipt(second,"evt_job_second","cs_test_job_second"));
    assert.throws(() => store.recordPaidProviderJob(first,"byteplus","task-123"), /claim/);
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
