import test from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {resolveVideoCheckoutOwner} from "../lib/commerce/video-checkout-owner.ts";
import type {PreparedMedia} from "../lib/live/store.ts";

const password="Correct horse battery phrase 2026!";
const media=(owner:string):PreparedMedia=>({
 owner,audioPath:"/private/input.mp3",imagePath:"/private/image.png",
 audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),durationSeconds:6,
 prompt:"Natural performance",outputFormat:"9:16",
} as PreparedMedia);

test("P0 signed-in unrelated account cannot block or steal a guest-paid checkout",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const buyer=store.register("buyer-p0@example.test",password);
  const other=store.register("other-p0@example.test",password);
  const verified=store.issueEmailVerification(other)!;
  assert.equal(store.verifyEmailToken(verified.token),true);
  const guest=store.preparedVideoOrder({
   account:null,email:"buyer-p0@example.test",project:"guest-music",
   cents:150,quoteEvidence:"reviewed-guest-quote-p0",key:"guest-checkout-p0",
   media:media("c71438f0-ae64-4418-a3f4-607c693ae198"),
  });
  assert.ok(guest.guestToken);
  const direct=resolveVideoCheckoutOwner(store,guest.id,null,guest.guestToken!);
  assert.equal(direct.kind,"guest");
  const withOtherLogin=resolveVideoCheckoutOwner(store,guest.id,other,guest.guestToken!);
  assert.equal(withOtherLogin.kind,"guest");
  if(withOtherLogin.kind!=="guest")throw Error("Guest owner required");
  store.recordGuestEarlyPerformanceConsent(guest.id,withOtherLogin.guestToken);
  assert.equal(store.hasEarlyPerformanceConsent(guest.id),true);
  assert.throws(()=>resolveVideoCheckoutOwner(store,guest.id,other,undefined),/owner required/);
  assert.throws(()=>resolveVideoCheckoutOwner(store,guest.id,other,"wrong-token"),/unavailable/);
  assert.throws(()=>resolveVideoCheckoutOwner(store,guest.id,buyer,undefined),/owner required/);
 }finally{store.close()}
});
test("P0 account-paid checkout cannot be authorized by a separate guest capability",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const owner=store.register("owner-p0@example.test",password);
  const other=store.register("attacker-p0@example.test",password);
  const verified=store.issueEmailVerification(owner)!;
  assert.equal(store.verifyEmailToken(verified.token),true);
  const order=store.preparedVideoOrder({
   account:owner,email:"owner-p0@example.test",project:"account-song",
   cents:150,quoteEvidence:"reviewed-account-quote-p0",key:"account-checkout-p0",
   media:media("customer-"+owner),
  });
  const authorized=resolveVideoCheckoutOwner(store,order.id,owner,"invalid");
  assert.equal(authorized.kind,"account");
  assert.throws(()=>resolveVideoCheckoutOwner(store,order.id,other,"invalid"),/unavailable/);
  assert.throws(()=>resolveVideoCheckoutOwner(store,order.id,null,undefined),/owner required/);
 }finally{store.close()}
});
