import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { stripeCheckoutAdapter } from "../lib/commerce/stripe-webhook.ts";

const secret = "whsec_" + "test".repeat(12);
const orderId = "11111111-2222-4333-8444-555555555555";
const event = () => ({
  id: "evt_test_payment_1",
  livemode: false,
  type: "checkout.session.completed",
  data: { object: {
    object: "checkout.session", id: "cs_test_payment_1",
    mode: "payment", payment_status: "paid", currency: "eur",
    amount_total: 252, metadata: { orderId },
  } },
});
const signed = (value: unknown, timestamp = Math.floor(Date.now() / 1000)) => {
  const raw = Buffer.from(JSON.stringify(value));
  const digest = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(timestamp + "."), raw])).digest("hex");
  return { raw, signature: `t=${timestamp},v1=${digest}` };
};
test("signed, paid sandbox checkout yields a verified receipt", async () => {
  const {raw,signature} = signed(event());
  const receipt = await stripeCheckoutAdapter(secret).verify(raw, signature);
  assert.deepEqual(receipt, {
    eventId: "evt_test_payment_1", provider: "stripe", orderId,
    cents: 252, currency: "EUR", evidence: "cs_test_payment_1",
  });
});
test("rejects modified payloads and stale signatures", async () => {
  const valid = signed(event());
  await assert.rejects(() => stripeCheckoutAdapter(secret).verify(
    Buffer.from(JSON.stringify({...event(), id: "evt_modified"})), valid.signature,
  ), /signature/i);
  const old = signed(event(), Math.floor(Date.now()/1000) - 3600);
  await assert.rejects(() => stripeCheckoutAdapter(secret).verify(old.raw,old.signature), /signature/i);
});
test("rejects unpaid, live-mode and non-checkout events", async () => {
  for (const update of [
    { data: { object: {...event().data.object, payment_status: "unpaid"} } },
    { livemode: true },
    { data: { object: {...event().data.object, id: "cs_live_abc"} } },
    { type: "payment_intent.succeeded" },
    { data: { object: {...event().data.object, amount_total: 1.5} } },
  ]) {
    const payload = { ...event(), ...update };
    const {raw,signature} = signed(payload);
    await assert.rejects(() => stripeCheckoutAdapter(secret).verify(raw,signature));
  }
});
