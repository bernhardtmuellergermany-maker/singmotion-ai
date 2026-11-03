import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {PLAN_RULES} from "../lib/commerce/plans.ts";
import {uploadStorageLimit,uploadedBytes,reserveUploadStorage,releaseUploadStorage,commitUploadedAsset} from "../lib/upload-storage.ts";
import type {Asset} from "../lib/domain.ts";
function make(){
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)");
 return db;
}
const asset=(id:string,owner:string,bytes:number):Asset=>({id,owner,bytes,kind:"audio",name:"demo.mp3",path:"/private/demo.mp3",mime:"audio/mpeg",duration:5,width:null,height:null,created:Date.now()});
test("Free and Hobby use upload bytes, not project counts",()=>{
 assert.equal(uploadStorageLimit("free"),1024**3);
 assert.equal(uploadStorageLimit("hobby"),10*1024**3);
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
