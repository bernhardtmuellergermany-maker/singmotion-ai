import test from "node:test";
import assert from "node:assert/strict";
import {checkoutFeedback,generationFeedback,providerFeedback,requestErrorFeedback} from "../lib/live/customer-feedback.ts";

test("provider prefilter refund is displayed only after durable ledger release",()=>{
  const held={credits:150,status:"review" as const};
  const released={credits:150,status:"released" as const};
  const stage="BytePlus rejected the content before generation. [CONTENT_PREFILTER_REJECTED]";
  const pending=providerFeedback("failed",stage,held);
  assert.match(pending?.message??"",/cannot yet confirm the credit release/i);
  assert.doesNotMatch(pending?.message??"",/have been released/i);
  const done=providerFeedback("failed",stage,released);
  assert.match(done?.title??"",/rejected by the provider/i);
  assert.match(done?.message??"",/150 reserved Credits have been released/i);
  assert.equal(done?.action?.href,"/credits#usage");
});

test("unknown provider outcome retains credits and never suggests a paid retry",()=>{
  const notice=generationFeedback("review",{credits:125,status:"review"});
  assert.match(notice?.message??"",/remain reserved/i);
  assert.doesNotMatch(notice?.message??"",/returned|refunded|charged/i);
  assert.equal(notice?.dismissAfterMs,undefined);
  const unknown=providerFeedback("uncertain","submission outcome unknown",{credits:125,status:"reserved"});
  assert.match(unknown?.message??"",/reserved/i);
});

test("insufficient balance explains the shortage and links to Credit topup",()=>{
  const notice=generationFeedback("credits-needed",{credits:250,status:"estimated"},100);
  assert.match(notice?.message??"",/150 more Credits/i);
  assert.match(notice?.message??"",/No Credits were charged/);
  assert.equal(notice?.action?.href,"/credits#buy-credits");
});

test("Stripe redirects distinguish cancellation from unverified success",()=>{
  assert.match(checkoutFeedback("cancelled")?.title??"",/cancelled/i);
  assert.match(checkoutFeedback("success")?.message??"",/only after the verified payment/i);
  assert.equal(checkoutFeedback("unknown"),null);
  assert.doesNotMatch(checkoutFeedback("success")?.message??"",/payment confirmed|credits added/i);
});

test("offline/payment timeouts are not called failed or refunded",()=>{
  const notice=requestErrorFeedback("Failed to fetch","payment");
  assert.match(notice.title,/Connection interrupted/);
  assert.match(notice.message,/cannot confirm whether Stripe received/i);
  assert.equal(notice.dismissAfterMs,undefined);
  assert.match(requestErrorFeedback("Upload timed out","upload").message,/may be incomplete/i);
  assert.match(requestErrorFeedback("Not enough available Credits","generation").action?.href??"",/credits#buy-credits/);
});

test("verified completion can fade, unsettled financial states cannot",()=>{
  assert.equal(generationFeedback("ready")?.dismissAfterMs,9000);
  for(const p of ["failed","review","verifying-payment","credits-needed"] as const)
    assert.equal(generationFeedback(p)?.dismissAfterMs,undefined);
});
