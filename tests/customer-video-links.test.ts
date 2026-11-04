import {test} from "node:test";
import assert from "node:assert/strict";
import {privateCustomerVideoLinks,customerVideoByteRange,customerPaidVideoLabel} from "../lib/commerce/customer-video-links.ts";
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

test("customer MP4 supports ordinary, open-ended and suffix HTTP byte ranges",()=>{
 const parse=(header:string|null)=>customerVideoByteRange(header,1000);
 assert.deepEqual(parse(null),{start:0,end:999,status:200});
 assert.deepEqual(parse("bytes=0-99"),{start:0,end:99,status:206});
 assert.deepEqual(parse("bytes=100-"),{start:100,end:999,status:206});
 assert.deepEqual(parse("bytes=-50"),{start:950,end:999,status:206});
 assert.deepEqual(parse("bytes=-3000"),{start:0,end:999,status:206});
 assert.deepEqual(parse("bytes=999-1200"),{start:999,end:999,status:206});
 for(const value of ["bytes=0-0,2-3","bytes=1000-","bytes=-0","bytes=-",
  "bytes=50-49","bytes=999999999999999999999-","bytes=a-b","bytes= 0-1",
  "items=0-1","bytes=0-1\nX-Test: 1"]){
  assert.equal(parse(value),null,value);
 }
 assert.equal(customerVideoByteRange(null,0),null);
 assert.equal(customerVideoByteRange(null,NaN),null);
});

test("refunded and disputed customer videos never appear unpaid or in progress",()=>{
 const label=(status:string,fulfillmentState:string|null="pending",videoReady=0)=>
  customerPaidVideoLabel({status,fulfillmentState,videoReady},true);
 assert.equal(customerPaidVideoLabel(null,false),"Loading video");
 assert.equal(customerPaidVideoLabel(null,true),"Video unavailable");
 assert.equal(label("awaiting_payment",null),"Awaiting payment");
 assert.equal(label("paid","pending"),"Preparing video");
 assert.equal(label("paid","processing"),"Preparing video");
 assert.equal(label("paid","failed"),"Requires review");
 assert.equal(label("paid","delivered",1),"Completed");
 assert.equal(label("paid","delivered",0),"Preparing video");
 assert.equal(label("refunded","failed"),"Payment refunded");
 assert.equal(label("refunded","delivered",1),"Payment refunded");
 assert.equal(label("disputed","pending"),"Payment requires review");
 assert.equal(label("disputed","processing",1),"Payment requires review");
 assert.equal(label("unknown",null),"Video unavailable");
});

test("delivered zero-EUR customer video links never use paid Stripe delivery endpoint",()=>{
 const id="11111111-1111-4111-8111-111111111111";
 const row={orderId:id,status:"free_delivered",videoReady:1,fulfillmentState:null};
 assert.deepEqual(privateCustomerVideoLinks(row),{
  videoUrl:`/api/customer-free-video?orderId=${id}`,
  downloadUrl:`/api/customer-free-video?orderId=${id}&download=1`
 });
 assert.equal(customerPaidVideoLabel(row,true),"Completed");
 assert.deepEqual(privateCustomerVideoLinks({...row,videoReady:0}),{
  videoUrl:null,downloadUrl:null
 });
 assert.equal(customerPaidVideoLabel({...row,videoReady:0},true),"Requires review");
});
