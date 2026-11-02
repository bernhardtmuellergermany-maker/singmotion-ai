import {test} from "node:test";
import assert from "node:assert/strict";
import {privateCustomerVideoLinks} from "../lib/commerce/customer-video-links.ts";
const id="11111111-1111-4111-8111-111111111111";
test("customer MP4 links only appear for a paid and delivered UUID order",()=>{
 assert.deepEqual(privateCustomerVideoLinks({orderId:id,status:"paid",videoReady:1}),{
  videoUrl:`/api/customer-video?orderId=${id}`,
  downloadUrl:`/api/customer-video?orderId=${id}&download=1`
 });
 for(const o of [{status:"paid",videoReady:0},{status:"awaiting_payment",videoReady:1},
  {status:"paid",videoReady:null}]){
  assert.deepEqual(privateCustomerVideoLinks({orderId:id,...o}),{videoUrl:null,downloadUrl:null});
 }
 assert.deepEqual(privateCustomerVideoLinks({orderId:"../secret",status:"paid",videoReady:1}),{videoUrl:null,downloadUrl:null});
});
