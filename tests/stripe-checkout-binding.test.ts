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
