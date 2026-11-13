import test from "node:test";
import assert from "node:assert/strict";
import {checkoutFeedback,editInputsAction,generationFeedback,providerFeedback,paidOrderFeedback,requestErrorFeedback} from "../lib/live/customer-feedback.ts";

test("provider prefilter refund is displayed only after durable ledger release",()=>{
  const held={credits:150,status:"review" as const};
  const released={credits:150,status:"released" as const};
  const stage="BytePlus rejected the content before generation. [CONTENT_PREFILTER_REJECTED]";
  const pending=providerFeedback("failed",stage,held);
  assert.match(pending?.message??"",/cannot yet confirm that the Credit reservation was released/i);
  assert.doesNotMatch(pending?.message??"",/have been released/i);
  const done=providerFeedback("failed",stage,released);
  assert.match(done?.title??"",/not accepted.*Credits released/i);
  assert.match(done?.message??"",/150 reserved Credits have been released/i);
  assert.equal(done?.action?.label,"Edit photo or audio");
  assert.equal(done?.action?.href,"/studio");
  assert.notEqual(done?.action?.href,"/credits#usage");
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

test("verified 50510 release offers owner-checked draft editing, not a wallet detour",()=>{
  const editHref="/studio?copy=live_550e8400-e29b-41d4-a716-446655440000";
  const done=providerFeedback("failed","[CONTENT_PREFILTER_REJECTED]",
    {credits:150,status:"released"},undefined,Date.now(),editHref);
  assert.equal(done?.action?.href,editHref);
  assert.equal(done?.action?.label,"Edit photo or audio");
  assert.match(done?.message??"",/available again/i);
  assert.doesNotMatch(done?.message??"",/pay again|contact support|check credits/i);
  assert.equal(editInputsAction("https://attacker.example/steal").href,"/studio");
  assert.equal(editInputsAction("/studio?copy=live_invalid&id=1").href,"/studio");
  assert.equal(editInputsAction("/credits#usage").href,"/studio");
});

test("provider prefilter with UNRELEASED wallet retains honest billing state and still supports editing",()=>{
  for(const status of ["reserved","review"] as const){
    const notice=providerFeedback("failed","Task rejected [CONTENT_PREFILTER_REJECTED]",{credits:150,status});
    assert.match(notice?.title??"",/Credit release pending/i);
    assert.match(notice?.message??"",/cannot yet confirm/i);
    assert.equal(notice?.action?.label,"Edit photo or audio");
    assert.doesNotMatch(notice?.message??"",/Credits have been released/i);
    assert.equal(notice?.dismissAfterMs,undefined);
  }
});

test("other provider problems never pretend photo edits fix delivery or refund reserved credits",()=>{
  const charge={credits:150,status:"review" as const};
  for(const code of ["PROVIDER_JOB_FAILED","PROVIDER_TASK_CANCELED"]){
    const notice=providerFeedback("failed",`[${code}]`,charge);
    assert.match(notice?.title??"",/provider stopped/i);
    assert.equal(notice?.action,undefined);
    assert.doesNotMatch(notice?.message??"",/released|refunded/i);
  }
  for(const code of ["MISSING_OUTPUT","OUTPUT_MP4_VALIDATION_FAILED","TEMPO_RESTORATION_FAILED"]){
    const notice=providerFeedback("failed",`[${code}]`,charge);
    assert.match(notice?.title??"",/output could not be verified/i);
    assert.equal(notice?.action,undefined);
    assert.doesNotMatch(notice?.message??"",/replace photo|upload again/i);
  }
});

test("released vs held vs unknown outcomes use distinct, actionable messages",()=>{
  const release=generationFeedback("failed",{credits:125,status:"released"});
  assert.equal(release?.action?.label,"Edit photo or audio");
  assert.match(release?.message??"",/125 reserved Credits have been released/);
  const held=generationFeedback("failed",{credits:125,status:"review"});
  assert.match(held?.message??"",/remain reserved/i);
  assert.equal(held?.action,undefined);
  const uncertain=providerFeedback("uncertain","[SUBMISSION_OUTCOME_UNKNOWN]",
    {credits:125,status:"reserved"});
  assert.match(uncertain?.message??"",/reserved/i);
  assert.equal(uncertain?.action,undefined);
  assert.equal(uncertain?.dismissAfterMs,undefined);
});

test("only insufficient balance leads to buying Credits; payment and upload errors do not",()=>{
  assert.equal(generationFeedback("credits-needed")?.action?.label,"Buy Credits");
  for(const notice of [
    checkoutFeedback("cancelled"),checkoutFeedback("success"),
    requestErrorFeedback("Upload timed out","upload"),
    requestErrorFeedback("Payment failed, card declined","payment"),
    providerFeedback("processing","Provider busy",{credits:125,status:"reserved"}),
  ])assert.notEqual(notice?.action?.label,"Buy Credits");
});

test("verified paid-order refund shows editor only for owner-scoped project draft",()=>{
  const safe="/studio?copy=draft_38cd9f61-ed61-49d7-82cf-42d5177f6729";
  const notice=paidOrderFeedback("refunded","failed",safe);
  assert.match(notice?.title??"",/payment was refunded/i);
  assert.equal(notice?.action?.href,safe);
  assert.equal(notice?.action?.label,"Edit photo or audio");
  assert.doesNotMatch(notice?.message??"",/Credits released/i);
  assert.equal(paidOrderFeedback("refunded","failed","https://evil.example")?.action?.href,"/studio?new=1");
});

test("paid provider failure never promises Stripe refund or another paid task",()=>{
  const pending=paidOrderFeedback("paid","failed");
  assert.match(pending?.title??"",/paid video could not be delivered/i);
  assert.match(pending?.message??"",/refund eligibility must be verified/i);
  assert.equal(pending?.action,undefined);
  assert.doesNotMatch(pending?.message??"",/refund was issued|refunded/i);
  const disputed=paidOrderFeedback("disputed","failed");
  assert.match(disputed?.title??"",/payment is under review/i);
  assert.equal(disputed?.action,undefined);
  assert.equal(paidOrderFeedback("paid","processing"),null);
  assert.equal(paidOrderFeedback("awaiting_payment",null),null);
});

test("legacy and already settled tasks never imply a credit reservation can be released",()=>{
  const legacy=providerFeedback("failed","[CONTENT_PREFILTER_REJECTED]",{credits:150,status:"legacy"});
  assert.match(legacy?.message??"",/no confirmed prepaid Credit reservation/i);
  assert.doesNotMatch(legacy?.message??"",/will be released|have been released/i);
  const settled=providerFeedback("failed","[CONTENT_PREFILTER_REJECTED]",{credits:150,status:"settled"});
  assert.match(settled?.message??"",/recorded final charge/i);
  assert.doesNotMatch(settled?.message??"",/Credits have been released/i);
  assert.equal(settled?.dismissAfterMs,undefined);
});
