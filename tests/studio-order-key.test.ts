import assert from "node:assert/strict";
import test from "node:test";
import {reviewedCustomerOrderKey} from "../lib/commerce/studio-order-key.ts";

const base={
 accountId:"123e4567-e89b-12d3-a456-426614174000",
 projectId:"123e4567-e89b-12d3-a456-426614174001",
 draft:{owner:"customer-123e4567-e89b-12d3-a456-426614174000",songId:"song-a",imageId:"artist-a",start:0,end:7.7,customPrompt:"Static camera"},
};
test("identical reviewed customer selection uses the same order key",()=>{
 const first=reviewedCustomerOrderKey(base);
 assert.match(first,/^[a-f0-9]{64}$/);
 assert.equal(reviewedCustomerOrderKey({...base,draft:{...base.draft}}),first);
});
test("changed media, duration, prompt and promotion cannot reuse old order",()=>{
 const key=reviewedCustomerOrderKey(base);
 for(const draft of [
  {...base.draft,end:8.3},
  {...base.draft,imageId:"artist-b"},
  {...base.draft,songId:"song-b"},
  {...base.draft,customPrompt:"Orbit left"},
 ]){
  assert.notEqual(reviewedCustomerOrderKey({...base,draft}),key);
 }
 assert.notEqual(reviewedCustomerOrderKey({...base,promoCode:"PROMO20"}),key);
 assert.equal(reviewedCustomerOrderKey({...base,promoCode:"promo20 "}),reviewedCustomerOrderKey({...base,promoCode:"PROMO20"}));
});
test("account and saved project scope cannot reuse another user's order",()=>{
 const key=reviewedCustomerOrderKey(base);
 assert.notEqual(reviewedCustomerOrderKey({...base,accountId:"other-account"}),key);
 assert.notEqual(reviewedCustomerOrderKey({...base,projectId:"other-project"}),key);
});
