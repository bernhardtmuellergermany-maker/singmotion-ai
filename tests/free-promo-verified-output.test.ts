import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,mkdir,chmod,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {PromotionLedger} from "../lib/commerce/promotions.ts";
import {FreePromoBudgetLedger,signOperatorFreePromoApproval} from "../lib/commerce/free-promo-budget.ts";
import {verifyPreparedFreeOutput} from "../lib/commerce/free-promo-verified-output.ts";
import type {OutputValidationContract} from "../lib/live/output.ts";

const secret="offline-only-free-output-review-secret-longer-than-32-characters";
const now=Date.parse("2026-11-04T12:00:00.000Z");
const contract:OutputValidationContract={
 outputHosts:["outputs.example.test"],
 output:{width:160,height:284,fps:25,durationToleranceSeconds:0.1,maxDurationSeconds:10}
};
const policy={operatorEnabled:true,perJobMicroUsd:100000,perPromoMicroUsd:200000,
 rollingDayMicroUsd:200000,lifetimeMicroUsd:200000};
test("claimed free-video MP4 is fully decoded and SHA-256 verified without any paid or voucher settlement",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"singmotion-free-video-"));
 const store=new CommerceStore(":memory:");
 try{
  const account=store.register("free-proof@example.test","unique-verified-free-output-password");
  const other=store.register("wrong-account@example.test","unique-unrelated-password-2026");
  const promo=new PromotionLedger(store.db);
  promo.create({code:"THREEFREE",kind:"free_videos",freeVideos:3,maxVideoSeconds:10,
   startsAt:"2026-10-01T00:00:00.000Z",endsAt:"2026-12-31T00:00:00.000Z",
   maxUses:3},now);
  const ledger=new FreePromoBudgetLedger(store.db);
  const media={owner:"customer-"+account,sourceJobId:"prepared-free-source",
   imagePath:"/private/image.png",audioPath:"/private/audio.wav",
   imageSha256:"a".repeat(64),audioSha256:"b".repeat(64),
   durationSeconds:5,prompt:"Sing",outputFormat:"9:16" as const,
   promptLanguageConfirmed:true};
  const id=store.preparedVideoOrder({account,email:"free-proof@example.test",
   project:"free-proof",cents:0,originalCents:125,promoCode:"THREEFREE",
   quoteEvidence:"reviewed-free-video-fixture",key:"free-output-proof",
   media}).id;
  const signed=signOperatorFreePromoApproval({orderId:id,accountId:account,
   maxMicroUsd:100000,expiresAt:now+300000},secret);
  const mediaRoot=path.join(root,"media");
  await mkdir(mediaRoot,{recursive:true});
  const file=path.join(mediaRoot,`free-${id}.mp4`);
  await promisify(execFile)("ffmpeg",[
   "-nostdin","-v","error","-f","lavfi","-i",
   "color=c=black:s=160x284:r=25:d=5","-f","lavfi","-i",
   "sine=frequency=440:sample_rate=44100:duration=5",
   "-c:v","libx264","-threads","2","-pix_fmt","yuv420p",
   "-c:a","aac","-shortest","-movflags","+faststart",file
  ],{timeout:60000});
  await chmod(file,0o600);
  await assert.rejects(verifyPreparedFreeOutput(store,id,account,root,contract,now),
   /claimed free-video/);
  ledger.authorize(signed,secret,policy,now);
  ledger.claimProviderAttempt(signed,secret,true,now+1000);
  await assert.rejects(verifyPreparedFreeOutput(store,id,other,root,contract,now+2000),
   /claimed free-video/);
  const proof=await verifyPreparedFreeOutput(store,id,account,root,contract,now+2000);
  const content=await readFile(file);
  assert.equal(proof.bytes,content.length);
  assert.equal(proof.sha256,createHash("sha256").update(content).digest("hex"));
  assert.equal((store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id) as {status:string}).status,"awaiting_payment");
  assert.equal(promo.list()[0].reserved,1);
  assert.equal(promo.list()[0].redeemed,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_video_deliveries").get()?.n,0);
  assert.equal(store.pendingPaidFulfillment().length,0);
  await chmod(file,0o644);
  await assert.rejects(verifyPreparedFreeOutput(store,id,account,root,contract,now+3000),
   /Unsafe private/);
  await chmod(file,0o600);
  await writeFile(file,Buffer.from("fake-mp4"));
  await assert.rejects(verifyPreparedFreeOutput(store,id,account,root,contract,now+4000));
  assert.equal(promo.list()[0].redeemed,0);
 }finally{store.close();await rm(root,{recursive:true,force:true})}
});
