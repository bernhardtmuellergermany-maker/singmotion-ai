import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {PutObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {projectCloudKey,projectR2Enabled,validProjectCloudRecord,mirrorProjectBytes,verifiedCloudBytes} from "../lib/music-video/project-r2.ts";
const env={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",PROJECT_VIDEO_R2_ENABLED:"true",PROJECT_VIDEO_R2_VERIFIED:"true"};
const prod={...env,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"};
const project="11111111-1111-4111-8111-111111111111",asset="22222222-2222-4222-8222-222222222222";
const bytes=Buffer.from("test video"),sha256=createHash("sha256").update(bytes).digest("hex");
test("Projects cloud keys isolate owner and environment, writes are gated",()=>{
 const key=projectCloudKey("staff:a",project,asset,sha256,env),record={key,sha256,bytes:bytes.length};
 assert.ok(projectR2Enabled(env));assert.ok(!projectR2Enabled({}));assert.ok(!projectR2Enabled({...env,PROJECT_VIDEO_R2_VERIFIED:"false"}));
 assert.ok(validProjectCloudRecord("staff:a",project,asset,record,env));
 assert.ok(!validProjectCloudRecord("staff:b",project,asset,record,env));
 assert.ok(!validProjectCloudRecord("staff:a",project,asset,record,prod));
 assert.throws(()=>projectCloudKey("customer:a",project,asset,sha256,env));
});
test("migration demands full byte-for-byte readback, not just metadata",async()=>{
 const key=projectCloudKey("staff:a",project,asset,sha256,env);
 let stored:Buffer|undefined;
 const client={async send(c:any){
  if(c instanceof PutObjectCommand){assert.equal(c.input.IfNoneMatch,"*");stored=c.input.Body;return {};}
  assert.ok(c instanceof GetObjectCommand);assert.ok(stored);
  return {ContentLength:stored.length,Metadata:{"singmotion-sha256":sha256},Body:[stored]};
 }};
 const record=await mirrorProjectBytes(client,"test",key,bytes,"video/mp4");
 assert.deepEqual(await verifiedCloudBytes(client,"test",record),bytes);
 stored=Buffer.alloc(bytes.length);await assert.rejects(verifiedCloudBytes(client,"test",record),/checksum/);
});
