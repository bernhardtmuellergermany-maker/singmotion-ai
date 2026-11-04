import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,chmod,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {CommerceStore} from "../lib/commerce/store.ts";
import {PromotionLedger} from "../lib/commerce/promotions.ts";
import {FreePromoBudgetLedger,signOperatorFreePromoApproval} from "../lib/commerce/free-promo-budget.ts";
import {settleVerifiedFreePromoVideo} from "../lib/commerce/free-promo-settlement.ts";
import {openVerifiedFreeVideoFile} from "../lib/commerce/free-promo-private-file.ts";
import {customerOrderStatusFilter,ownedCustomerOrderStatuses} from "../lib/commerce/customer-orders-query.ts";
import {privateCustomerVideoLinks} from "../lib/commerce/customer-video-links.ts";
import {customerVideoByteRange} from "../lib/commerce/customer-video-links.ts";
import {streamVerifiedPaidVideoRange} from "../lib/commerce/private-video-file.ts";

const now=Date.parse("2026-11-04T12:00:00.000Z");
const secret="offline-private-free-delivery-operator-secret-very-long";
const contract={outputHosts:["outputs.example.test"],output:{
 width:160,height:284,fps:25,durationToleranceSeconds:0.1,maxDurationSeconds:10
}};
const policy={operatorEnabled:true,perJobMicroUsd:100000,perPromoMicroUsd:200000,
 rollingDayMicroUsd:200000,lifetimeMicroUsd:200000};
test("offline free MP4 -> signed claim -> verified owner-only stream -> atomic voucher redemption, no Stripe",async()=>{
 const beforeEnv=process.env.RAILWAY_ENVIRONMENT_ID, beforeFlag=process.env.FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED;
 const root=await mkdtemp(path.join(tmpdir(),"singmotion-free-delivery-"));
 const store=new CommerceStore(":memory:");
 try{
  const account=store.register("zero-eur@example.test","unique-zero-eur-test-password");
  const other=store.register("other-zero@example.test","different-zero-eur-test-password");
  const promo=new PromotionLedger(store.db);
  promo.create({code:"THREEFREE",kind:"free_videos",freeVideos:3,maxVideoSeconds:10,
   startsAt:"2026-10-01T00:00:00.000Z",endsAt:"2026-12-31T00:00:00.000Z",
   maxUses:3},now);
  const ledger=new FreePromoBudgetLedger(store.db);
  const media={owner:"customer-"+account,sourceJobId:"free-delivery-offline",
   audioPath:"/private/audio.mp3",imagePath:"/private/image.png",
   audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),
   durationSeconds:5,prompt:"Live-free-e2e",outputFormat:"9:16" as const,
   promptLanguageConfirmed:true};
  const id=store.preparedVideoOrder({account,email:"zero-eur@example.test",project:"free-delivery-e2e",
   cents:0,originalCents:125,promoCode:"THREEFREE",
   quoteEvidence:"reviewed-free-delivery-e2e",key:"free-delivery-e2e",media}).id;
  const approval=signOperatorFreePromoApproval({orderId:id,accountId:account,
   maxMicroUsd:100000,expiresAt:now+300000},secret);
  const dir=path.join(root,"media");await mkdir(dir,{recursive:true});
  const file=path.join(dir,`free-${id}.mp4`);
  await promisify(execFile)("ffmpeg",[
   "-nostdin","-v","error","-f","lavfi","-i","color=c=black:s=160x284:r=25:d=5",
   "-f","lavfi","-i","sine=frequency=440:sample_rate=44100:duration=5",
   "-c:v","libx264","-threads","2","-pix_fmt","yuv420p",
   "-c:a","aac","-shortest","-movflags","+faststart",file
  ],{timeout:60000});
  await chmod(file,0o600);
  process.env.RAILWAY_ENVIRONMENT_ID="36adc41d-7e54-4396-ad1a-fd432ba0441d";
  process.env.FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED="true";
  await assert.rejects(settleVerifiedFreePromoVideo(store,approval,secret,root,contract,true,now),
   /separately enabled Staging/);
  process.env.RAILWAY_ENVIRONMENT_ID="dfaeabed-03df-43ed-aa71-50f343a75041";
  delete process.env.FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED;
  await assert.rejects(settleVerifiedFreePromoVideo(store,approval,secret,root,contract,true,now),
   /separately enabled Staging/);
  process.env.FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED="true";
  await assert.rejects(settleVerifiedFreePromoVideo(store,approval,secret,root,contract,true,now),
   /claimed free-video/);
  ledger.authorize(approval,secret,policy,now);
  ledger.claimProviderAttempt(approval,secret,true,now+1000);
  await assert.rejects(settleVerifiedFreePromoVideo(store,
   {...approval,signature:"0".repeat(64)},secret,root,contract,true,now+2000),/forged/);
  const result=await settleVerifiedFreePromoVideo(store,approval,secret,root,contract,true,now+2000);
  const original=await readFile(file);
  assert.equal(result.bytes,original.length);
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,"free_delivered");
  assert.equal(store.db.prepare("SELECT state FROM free_promo_budget_authorizations WHERE order_id=?").get(id)?.state,"delivered");
  assert.equal(promo.list()[0].reserved,0);
  assert.equal(promo.list()[0].redeemed,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()?.n,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n,0);
  assert.deepEqual(store.pendingPaidFulfillment(),[]);
  assert.equal(ownedCustomerOrderStatuses(store.db,other,customerOrderStatusFilter(id,null)).length,0);
  const rows=ownedCustomerOrderStatuses(store.db,account,customerOrderStatusFilter(id,null));
  assert.equal(rows[0].videoReady,1);
  assert.deepEqual(privateCustomerVideoLinks(rows[0]),{
   videoUrl:`/api/customer-free-video?orderId=${id}`,
   downloadUrl:`/api/customer-free-video?orderId=${id}&download=1`
  });
  const handle=await openVerifiedFreeVideoFile(dir,id,result.bytes,result.sha256);
  const range=customerVideoByteRange("bytes=32-127",result.bytes);
  assert.deepEqual(range,{start:32,end:127,status:206});
  const streamed=await new Response(streamVerifiedPaidVideoRange(handle,range!.start,range!.end)).arrayBuffer();
  assert.deepEqual(Buffer.from(streamed),original.subarray(32,128));
  await assert.rejects(openVerifiedFreeVideoFile(dir,id,result.bytes,"0".repeat(64)),/digest mismatch/);
  await assert.rejects(settleVerifiedFreePromoVideo(store,approval,secret,root,contract,true,now+3000),
   /claimed free-video/);
  assert.equal(promo.list()[0].redeemed,1);
  await writeFile(file,Buffer.from("corrupt"));
  await assert.rejects(openVerifiedFreeVideoFile(dir,id,result.bytes,result.sha256));
  assert.equal(promo.list()[0].redeemed,1);
 }finally{
  store.close();await rm(root,{recursive:true,force:true});
  if(beforeEnv===undefined)delete process.env.RAILWAY_ENVIRONMENT_ID;
  else process.env.RAILWAY_ENVIRONMENT_ID=beforeEnv;
  if(beforeFlag===undefined)delete process.env.FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED;
  else process.env.FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED=beforeFlag;
 }
});
