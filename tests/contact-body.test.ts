import test from "node:test";
import assert from "node:assert/strict";
import {readContactBody} from "../lib/contact-body.ts";

const request=(body:string)=>new Request("https://example.invalid/api/contact",{
 method:"POST",body
});

test("contact body streaming guard accepts the byte-size boundary",async()=>{
 const allowed="a".repeat(12_000);
 assert.equal(await readContactBody(request(allowed)),allowed);
 assert.equal(await readContactBody(request("ok")),"ok");
 assert.equal(await readContactBody(request("")),"");
});
test("contact body streaming guard rejects oversized content before full buffering",async()=>{
 assert.equal(await readContactBody(request("x".repeat(12_001))),null);
 assert.equal(await readContactBody(request("🦉".repeat(3_001))),null);
});
test("streamed bodies without Content-Length cannot bypass byte-size limit",async()=>{
 let requested=0, cancelled=false;
 const stream=new ReadableStream<Uint8Array<ArrayBuffer>>({
  pull(controller){
   requested++;
   controller.enqueue(Buffer.alloc(6000,97));
  },
  cancel(){cancelled=true;}
 });
 assert.equal(await readContactBody({body:stream}),null);
 assert.ok(requested>=3&&requested<=5);
 assert.equal(cancelled,true);
});
test("read failure denies processing and does not expose request content",async()=>{
 const body=new ReadableStream<Uint8Array<ArrayBuffer>>({
  pull(controller){controller.error(new Error("synthetic private message secret"));}
 });
 assert.equal(await readContactBody({body}),null);
 assert.equal(await readContactBody({body:null}),"");
});
