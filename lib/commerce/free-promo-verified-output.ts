/** Trusted operator-only PRE-SETTLEMENT output verification.
 * This does not dispatch a provider task, redeem a voucher, mark an order
 * paid/delivered, or publish a customer download. The proof is deliberately
 * ephemeral until an independently reviewed private delivery workflow ships.
 */
import {createReadStream} from "node:fs";
import {lstat,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import type {CommerceStore} from "./store.ts";
import {validateOutput,outputTransferLimits,type OutputValidationContract} from "../live/output.ts";

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type FreeOutputProof={
 orderId:string;accountId:string;bytes:number;sha256:string;checkedAt:number;
};
export async function verifyPreparedFreeOutput(
 store:CommerceStore,orderId:string,accountId:string,dataDir:string,
 contract:OutputValidationContract,now=Date.now(),
):Promise<FreeOutputProof>{
 if(!uuid.test(orderId)||!uuid.test(accountId)||!Number.isSafeInteger(now)||now<1)
  throw Error("Invalid free-output verification identity");
 const row=store.db.prepare(`SELECT a.state,a.account_id,o.status,o.price_cents,
  p.state AS promo_state,c.kind,c.max_video_seconds,m.media_json
  FROM free_promo_budget_authorizations a
  JOIN customer_orders o ON o.id=a.order_id AND o.account_id=a.account_id
  JOIN promo_redemptions p ON p.order_id=a.order_id AND p.account_id=a.account_id
  JOIN promo_codes c ON c.code=p.code AND c.code=a.code
  JOIN customer_prepared_media m ON m.order_id=a.order_id
  WHERE a.order_id=?`).get(orderId) as {
   state:string;account_id:string;status:string;price_cents:number;
   promo_state:string;kind:string;max_video_seconds:number;media_json:string;
  }|undefined;
 if(!row||row.account_id!==accountId||row.state!=="submitted_or_unknown"||
  row.status!=="awaiting_payment"||row.price_cents!==0||
  row.promo_state!=="reserved"||row.kind!=="free_videos"||row.max_video_seconds!==10)
  throw Error("Verified claimed free-video attempt required");
 const media=JSON.parse(row.media_json) as {owner?:string;durationSeconds?:number};
 if(media.owner!==`customer-${accountId}`||!Number.isFinite(media.durationSeconds)||
  media.durationSeconds!<5||media.durationSeconds!>10)
  throw Error("Invalid free-video reviewed duration or ownership");
 const root=path.resolve(dataDir,"media");
 // A deterministic server-owned path: never use an arbitrary path from a
 // browser, a signed provider URL, or a customer-controlled filename.
 const file=path.join(root,`free-${orderId}.mp4`);
 const sizeLimit=Math.min(outputTransferLimits(contract).maxBytes,100*1024*1024);
 const before=await lstat(file);
 if(!before.isFile()||before.nlink!==1||(before.mode&0o077)!==0||
  before.size<1||before.size>sizeLimit||await realpath(file)!==file)
  throw Error("Unsafe private free-video output");
 await validateOutput(file,media.durationSeconds!,contract);
 const digest=createHash("sha256");
 let bytes=0;
 for await(const chunk of createReadStream(file)){
  bytes+=chunk.length;
  if(bytes>sizeLimit||bytes>before.size)
   throw Error("Free output changed during validation");
  digest.update(chunk);
 }
 const after=await lstat(file);
 if(bytes!==before.size||after.size!==before.size||
  after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||
  !after.isFile()||after.nlink!==1||(after.mode&0o077)!==0)
  throw Error("Free output changed during validation");
 return {orderId,accountId,bytes,sha256:digest.digest("hex"),checkedAt:now};
}
