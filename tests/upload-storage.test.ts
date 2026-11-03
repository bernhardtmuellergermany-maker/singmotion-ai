import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {PLAN_RULES} from "../lib/commerce/plans.ts";
import {uploadStorageLimit,uploadedBytes,reserveUploadStorage,releaseUploadStorage,commitUploadedAsset} from "../lib/upload-storage.ts";
import type {Asset} from "../lib/domain.ts";
import {privateSourceKey,validCloudRecord,customerR2Enabled} from "../lib/cloud-media.ts";
import {createHash} from "node:crypto";
function make(){
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)");
 return db;
}
const asset=(id:string,owner:string,bytes:number):Asset=>({id,owner,bytes,kind:"audio",name:"demo.mp3",path:"/private/"+id,mime:"audio/mpeg",duration:5,width:null,height:null,created:Date.now()});
test("Free and Hobby use upload bytes, not project counts",()=>{
 assert.equal(uploadStorageLimit("free"),250*1024**2);
 assert.equal(uploadStorageLimit("hobby"),2*1024**3);
 assert.equal(PLAN_RULES.free.monthlySeconds,0);
 assert.equal(uploadStorageLimit("guest"),250*1024*1024);
});
test("parallel pending upload reservations cannot exceed quota",()=>{
 const db=make(),owner="customer-example",a=randomUUID(),b=randomUUID();
 reserveUploadStorage(db,owner,a,80,100);
 assert.throws(()=>reserveUploadStorage(db,owner,b,30,100),/Upload storage full/);
 assert.equal(uploadedBytes(db,owner),0);
 commitUploadedAsset(db,asset(a,owner,80));
 assert.equal(uploadedBytes(db,owner),80);
 assert.throws(()=>reserveUploadStorage(db,owner,b,21,100),/Upload storage full/);
 reserveUploadStorage(db,owner,b,20,100);
 releaseUploadStorage(db,owner,b);
 reserveUploadStorage(db,owner,b,20,100);
 commitUploadedAsset(db,asset(b,owner,20));
 assert.equal(uploadedBytes(db,owner),100);
 db.close();
});
test("reservation is owner bound and failed commit cannot cross owners",()=>{
 const db=make(),id=randomUUID();
 reserveUploadStorage(db,"customer-a",id,20,100);
 assert.throws(()=>commitUploadedAsset(db,asset(id,"customer-b",20)),/reservation missing/);
 assert.equal(uploadedBytes(db,"customer-b"),0);
 commitUploadedAsset(db,asset(id,"customer-a",20));
 assert.equal(uploadedBytes(db,"customer-a"),20);
 releaseUploadStorage(db,"customer-a",id);
 db.close();
});
test("expiry releases stuck reservations but never deletes purchased or uploaded assets",()=>{
 const db=make(),old=randomUUID(),next=randomUUID();
 reserveUploadStorage(db,"customer-a",old,90,100,10);
 reserveUploadStorage(db,"customer-a",next,90,100,3600011);
 assert.equal(uploadedBytes(db,"customer-a"),0);
 assert.throws(()=>commitUploadedAsset(db,asset(old,"customer-a",90)),/reservation missing/);
 db.close();
});

test("Hobby downgrade to Free preserves existing assets and blocks only new over-quota uploads",()=>{
 const db=make(),owner="customer-downgrade",id=randomUUID();
 reserveUploadStorage(db,owner,id,2*1024**3,uploadStorageLimit("hobby"));
 commitUploadedAsset(db,asset(id,owner,2*1024**3));
 assert.equal(uploadedBytes(db,owner),2*1024**3);
 assert.throws(()=>reserveUploadStorage(db,owner,randomUUID(),1,uploadStorageLimit("free")) ,/Upload storage full/);
 assert.equal(uploadedBytes(db,owner),2*1024**3);
 assert.ok(db.prepare("SELECT id FROM assets WHERE id=?").get(id));
 db.close();
});

test("paid video delivery bytes are excluded from source upload quotas",()=>{
 const db=make(),owner="customer-video-owner";
 db.prepare("INSERT INTO assets(id,owner,data) VALUES(?,?,?)").run("video-1",owner,JSON.stringify({...asset("video-1",owner,200),"kind":"video"}));
 assert.equal(uploadedBytes(db,owner),0);
 reserveUploadStorage(db,owner,randomUUID(),60,100);
 db.close();
});
test("cloud source manifests are digest and owner-bound, committed atomically",()=>{
 const db=make(),owner="customer-11111111-1111-4111-8111-111111111111",id=randomUUID();
 const digest=createHash("sha256").update("upload").digest("hex");
 const record={key:privateSourceKey(owner,id,digest),sha256:digest,bytes:20};
 assert.ok(validCloudRecord(owner,id,record));
 assert.equal(validCloudRecord("customer-22222222-2222-4222-8222-222222222222",id,record),false);
 reserveUploadStorage(db,owner,id,20,100);
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
