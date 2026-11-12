import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {uploadedBytes,reserveUploadStorage,releaseUploadStorage,commitUploadedAsset} from "../lib/upload-storage.ts";
import type {Asset} from "../lib/domain.ts";
import {privateSourceKey,validCloudRecord,customerR2Enabled} from "../lib/cloud-media.ts";
import {createHash} from "node:crypto";
function make(){
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)");
 return db;
}
const asset=(id:string,owner:string,bytes:number):Asset=>({id,owner,bytes,kind:"audio",name:"demo.mp3",path:"/private/"+id,mime:"audio/mpeg",duration:5,width:null,height:null,created:Date.now()});
test("all accounts can reserve uploads irrespective of their accumulated source bytes",()=>{
 const db=make(),owner="customer-example";
 const old=randomUUID(),fresh=randomUUID();
 reserveUploadStorage(db,owner,old,40);
 commitUploadedAsset(db,asset(old,owner,40));
 reserveUploadStorage(db,owner,fresh,40);
 commitUploadedAsset(db,asset(fresh,owner,40));
 assert.equal(uploadedBytes(db,owner),80);
 db.close();
});
test("pending reservations keep independent IDs without imposing a cumulative plan quota",()=>{
 const db=make(),owner="guest-example",a=randomUUID(),b=randomUUID();
 reserveUploadStorage(db,owner,a,40);
 reserveUploadStorage(db,owner,b,40);
 commitUploadedAsset(db,asset(a,owner,40));
 releaseUploadStorage(db,owner,b);
 reserveUploadStorage(db,owner,b,40);
 commitUploadedAsset(db,asset(b,owner,40));
 assert.equal(uploadedBytes(db,owner),80);
 db.close();
});
test("reservation is owner bound and failed commit cannot cross owners",()=>{
 const db=make(),id=randomUUID();
 reserveUploadStorage(db,"customer-a",id,20);
 assert.throws(()=>commitUploadedAsset(db,asset(id,"customer-b",20)),/reservation missing/);
 assert.equal(uploadedBytes(db,"customer-b"),0);
 commitUploadedAsset(db,asset(id,"customer-a",20));
 assert.equal(uploadedBytes(db,"customer-a"),20);
 releaseUploadStorage(db,"customer-a",id);
 db.close();
});
test("expiry releases stuck reservations but never deletes purchased or uploaded assets",()=>{
 const db=make(),old=randomUUID(),next=randomUUID();
 reserveUploadStorage(db,"customer-a",old,40,10);
 reserveUploadStorage(db,"customer-a",next,40,3600011);
 assert.equal(uploadedBytes(db,"customer-a"),0);
 assert.throws(()=>commitUploadedAsset(db,asset(old,"customer-a",90)),/reservation missing/);
 db.close();
});

test("historical uploaded sources remain accessible after removal of old plan quotas",()=>{
 const db=make(),owner="customer-downgrade",id=randomUUID(),next=randomUUID();
 reserveUploadStorage(db,owner,id,40);
 commitUploadedAsset(db,asset(id,owner,40));
 reserveUploadStorage(db,owner,next,40);
 commitUploadedAsset(db,asset(next,owner,40));
 assert.equal(uploadedBytes(db,owner),80);
 assert.ok(db.prepare("SELECT id FROM assets WHERE id=?").get(id));
 db.close();
});
test("paid video delivery bytes are excluded from source upload quotas",()=>{
 const db=make(),owner="customer-video-owner";
 db.prepare("INSERT INTO assets(id,owner,data) VALUES(?,?,?)").run("video-1",owner,JSON.stringify({...asset("video-1",owner,200),"kind":"video"}));
 assert.equal(uploadedBytes(db,owner),0);
 reserveUploadStorage(db,owner,randomUUID(),40);
 db.close();
});
test("cloud source manifests are digest and owner-bound, committed atomically",()=>{
 const db=make(),owner="customer-11111111-1111-4111-8111-111111111111",id=randomUUID();
 const digest=createHash("sha256").update("upload").digest("hex");
 const record={key:privateSourceKey(owner,id,digest),sha256:digest,bytes:20};
 assert.ok(validCloudRecord(owner,id,record));
 assert.equal(validCloudRecord("customer-22222222-2222-4222-8222-222222222222",id,record),false);
 reserveUploadStorage(db,owner,id,20);
 commitUploadedAsset(db,asset(id,owner,20),record);
 assert.equal((db.prepare("SELECT COUNT(*) AS n FROM cloud_source_media WHERE asset_id=? AND owner=?").get(id,owner) as {n:number}).n,1);
 assert.equal(uploadedBytes(db,owner),20);
 db.close();
});
test("invalid cloud manifest rolls back source asset and leaves quota reservation",()=>{
 const db=make(),owner="customer-11111111-1111-4111-8111-111111111111",id=randomUUID();
 reserveUploadStorage(db,owner,id,20,100);
 const digest=createHash("sha256").update("upload").digest("hex");
 assert.throws(()=>commitUploadedAsset(db,asset(id,owner,20),{key:privateSourceKey(owner,id,digest),sha256:digest,bytes:19}),/manifest mismatch/);
 assert.equal(uploadedBytes(db,owner),0);
 assert.equal((db.prepare("SELECT COUNT(*) AS n FROM pending_upload_storage WHERE id=?").get(id) as {n:number}).n,1);
 releaseUploadStorage(db,owner,id);db.close();
});
test("R2 source replication is opt-in and never starts in production",()=>{
 const oldFlag=process.env.CUSTOMER_R2_STORAGE_ENABLED,oldEnv=process.env.RAILWAY_ENVIRONMENT_ID;
 try{
  process.env.CUSTOMER_R2_STORAGE_ENABLED="true";
  process.env.RAILWAY_ENVIRONMENT_ID="36adc41d-7e54-4396-ad1a-fd432ba0441d";
  assert.equal(customerR2Enabled(),false);
  process.env.RAILWAY_ENVIRONMENT_ID="dfaeabed-03df-43ed-aa71-50f343a75041";
  assert.equal(customerR2Enabled(),true);
 }finally{
  if(oldFlag===undefined)delete process.env.CUSTOMER_R2_STORAGE_ENABLED;else process.env.CUSTOMER_R2_STORAGE_ENABLED=oldFlag;
  if(oldEnv===undefined)delete process.env.RAILWAY_ENVIRONMENT_ID;else process.env.RAILWAY_ENVIRONMENT_ID=oldEnv;
 }
});

test("generated immutable Studio snapshots do not reduce customers' upload storage",()=>{
 const db=make(),owner="customer-snapshots",id=randomUUID();
 reserveUploadStorage(db,owner,id,50);
 commitUploadedAsset(db,asset(id,owner,50));
 const derived={...asset("job-abc-audio-"+("f".repeat(64)),owner,99),path:"/private/job-abc-"+("f".repeat(64))+".mp3"};
 db.prepare("INSERT INTO assets(id,owner,data) VALUES(?,?,?)").run(derived.id,owner,JSON.stringify(derived));
 assert.equal(uploadedBytes(db,owner),50);
 reserveUploadStorage(db,owner,randomUUID(),50);
 db.close();
});
