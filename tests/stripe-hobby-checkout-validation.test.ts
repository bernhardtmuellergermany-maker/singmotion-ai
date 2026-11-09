import test from "node:test";
import assert from "node:assert/strict";
import {verifiedHobbyCheckoutSession,verifiedReusableHobbyCheckoutSession,verifiedHobbyLiveProduct} from "../lib/commerce/stripe-hobby-checkout.ts";
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

test("resumed Hobby checkout validates Stripe's actual mode and original reservation",()=>{
 const pending={sessionId:valid.id,url:valid.url};
 const verified=verifiedReusableHobbyCheckoutSession(valid,"test",customer,pending,now);
 assert.equal(verified.id,valid.id);
 for(const changed of [
  {...valid,mode:"payment"},
  {...valid,mode:undefined},
  {...valid,status:"complete"},
  {...valid,client_reference_id:"someone-else"},
  {...valid,livemode:true},
  {...valid,id:"cs_test_another_customer"},
 ]){
  assert.throws(()=>verifiedReusableHobbyCheckoutSession(changed,"test",customer,pending,now));
 }
 assert.throws(()=>verifiedReusableHobbyCheckoutSession(valid,"test",customer,
  {...pending,sessionId:"cs_test_different"},now));
 assert.throws(()=>verifiedReusableHobbyCheckoutSession(valid,"test",customer,
  {...pending,url:"https://checkout.stripe.com/c/pay/cs_test_rogue"},now));
});

test("live Hobby checkout cannot create or resume a subscription for a staging product",()=>{
 const price={id:"price_live_fixture",product:"prod_fixture",livemode:true,active:true,
  nickname:"Hobby 4.99",lookup_key:"hobby_monthly_live"};
 const product={id:"prod_fixture",livemode:true,active:true,name:"SingMotion AI Hobby",
  description:"Subscription plan",metadata:{environment:"production"}};
 assert.equal(verifiedHobbyLiveProduct(price,product),true);
 for(const [p,v] of [
  [{...price,nickname:"Hobby STAGING"},product],
  [{...price,lookup_key:"hobby_monthly_staging"},product],
  [price,{...product,metadata:{environment:"staging"}}],
  [price,{...product,metadata:{}}],
  [price,{...product,metadata:{environment:"Production"}}],
  [price,{...product,description:"Subscription sandbox testing"}],
  [price,{...product,id:"prod_other"}],
  [price,{...product,active:false}],
  [price,{...product,livemode:false}],
  [{...price,product:"invalid/path"},product],
 ] as [unknown,unknown][]){
  assert.equal(verifiedHobbyLiveProduct(p,v),false);
 }
});
