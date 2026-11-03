import {test} from "node:test";
import assert from "node:assert/strict";
import {privateCustomerVideoLinks,customerVideoByteRange} from "../lib/commerce/customer-video-links.ts";
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
