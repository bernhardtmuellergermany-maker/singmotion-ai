import test from "node:test";
import assert from "node:assert/strict";
import {verifiedHobbyCheckoutSession} from "../lib/commerce/stripe-hobby-checkout.ts";
const now=Date.UTC(2026,10,6,11,0);
const customer="9c6a934f-d96f-42b6-92b7-39c613ba5c71";
const valid={id:"cs_test_hobby_123",livemode:false,mode:"subscription",status:"open",client_reference_id:customer,
 url:"https://checkout.stripe.com/c/pay/cs_test_hobby_123",expires_at:Math.floor(now/1000)+3600};
test("Hobby Checkout is bound to account and Stripe test session",()=>{
 const s=verifiedHobbyCheckoutSession(valid,"test",customer,now);
 assert.equal(s.id,valid.id);
 assert.equal(s.expiresAt,valid.expires_at*1000-30000);
});
test("Hobby Checkout accepts only correctly classified live session in live mode",()=>{
 const live={...valid,id:"cs_live_hobby_123",livemode:true,url:"https://checkout.stripe.com/c/pay/cs_live_hobby_123"};
 assert.equal(verifiedHobbyCheckoutSession(live,"live",customer,now).id,live.id);
 assert.throws(()=>verifiedHobbyCheckoutSession(valid,"live",customer,now));
 assert.throws(()=>verifiedHobbyCheckoutSession(live,"test",customer,now));
});
test("reject mismatch, replayed completed, unsafe URL, wrong account, missing mode and near expiry",()=>{
 for(const bad of [
  {...valid,livemode:true},{...valid,id:"cs_live_hobby_123"}, {...valid,mode:"payment"},
  {...valid,status:"complete"},{...valid,client_reference_id:"other-account"},
  {...valid,expires_at:Math.floor(now/1000)+30}, {...valid,url:"http://checkout.stripe.com/x"},
  {...valid,url:"https://checkout.stripe.com.evil.test/x"},
  {...valid,url:"https://checkout.stripe.com@evil.test/x"},
  {...valid,url:"https://checkout.stripe.com:9443/x"},
  {...valid,url:"https://evil.test/x"},
  {...valid,url:""},
  {...valid,client_reference_id:undefined},
 ])assert.throws(()=>verifiedHobbyCheckoutSession(bad,"test",customer,now));
});
