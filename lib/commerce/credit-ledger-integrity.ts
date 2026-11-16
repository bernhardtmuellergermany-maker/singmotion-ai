import type {DatabaseSync} from "node:sqlite";

/**
 * Read-only invariant audit for the existing prepaid Credit Wallet.
 *
 * Deliberately returns only a fixed set of diagnostic codes: never customer
 * identities, balances, payment session IDs, project IDs, or provider details.
 * A valid negative balance is possible after a verified refund of spent
 * Credits, so no non-negative-balance requirement is imposed.
 *
 * This is NOT a backup or restore test, proof of signed Stripe events, or
 * permission to release the website publicly.
 */
export type CreditLedgerAudit={
 ok:boolean;
 failed:string[];
};

const purchaseEventsSQL=`
 WITH events AS (
  SELECT p.status,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference='credit-topup:'||p.id) AS paid_n,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference='credit-topup:'||p.id AND l.subject=p.subject
      AND l.kind='purchase' AND l.delta=p.credits) AS paid_ok,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference='credit-reversal:'||p.id) AS reversed_n,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference='credit-reversal:'||p.id AND l.subject=p.subject
      AND l.kind IN ('refund','dispute') AND l.delta=-p.credits) AS reversed_ok
  FROM credit_topup_purchases p
 )
 SELECT COUNT(*) AS n FROM events WHERE NOT (
  (status='pending' AND paid_n=0 AND reversed_n=0) OR
  (status='paid' AND paid_n=1 AND paid_ok=1 AND reversed_n=0) OR
  (status='reversed' AND (
    (paid_n=0 AND reversed_n=0) OR
    (paid_n=1 AND paid_ok=1 AND reversed_n=1 AND reversed_ok=1)
  ))
 )
`;

const videoEventsSQL=`
 WITH events AS (
  SELECT v.state,
   (SELECT COUNT(*) FROM credit_wallet_ledger l WHERE l.reference IN (
    'video-charge:'||v.project_id,'video-release:'||v.project_id,
    'video-service-refund:'||v.project_id,'support-video-refund:'||v.project_id
   )) AS events_n,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference='video-charge:'||v.project_id
      AND l.subject=v.subject AND l.kind='video' AND l.delta=-v.credits) AS charge_ok,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference IN ('video-release:'||v.project_id,'video-service-refund:'||v.project_id)
      AND l.subject=v.subject AND l.delta=0
      AND ((l.reference='video-release:'||v.project_id AND l.kind='video-release')
       OR (l.reference='video-service-refund:'||v.project_id AND l.kind='video-service-refund'))
   ) AS release_ok,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference='support-video-refund:'||v.project_id
      AND l.subject=v.subject AND l.kind='support-video-refund' AND l.delta=0) AS support_zero_ok,
   (SELECT COUNT(*) FROM credit_wallet_ledger l
    WHERE l.reference='support-video-refund:'||v.project_id
      AND l.subject=v.subject AND l.kind='support-video-refund'
      AND l.delta=v.credits) AS support_positive_ok
  FROM credit_video_reservations v
 )
 SELECT COUNT(*) AS n FROM events WHERE NOT (
  (state IN ('reserved','review') AND events_n=0) OR
  (state='settled' AND events_n=1 AND charge_ok=1) OR
  (state='released' AND events_n=1 AND
    (release_ok=1 OR support_zero_ok=1)) OR
  (state='released' AND events_n=2 AND charge_ok=1 AND support_positive_ok=1)
 )
`;

const orphanEventsSQL=`
 SELECT COUNT(*) AS n FROM credit_wallet_ledger l
 WHERE (
   l.kind IN ('purchase','refund','dispute')
   AND NOT EXISTS (
    SELECT 1 FROM credit_topup_purchases p
    WHERE l.reference='credit-topup:'||p.id OR l.reference='credit-reversal:'||p.id
   )
 ) OR (
   l.kind IN ('video','video-release','video-service-refund','support-video-refund')
   AND NOT EXISTS (
    SELECT 1 FROM credit_video_reservations v
    WHERE l.reference IN (
      'video-charge:'||v.project_id,'video-release:'||v.project_id,
      'video-service-refund:'||v.project_id,'support-video-refund:'||v.project_id
    )
   )
 )
`;

function count(db:DatabaseSync,sql:string):number{
 const row=db.prepare(sql).get() as {n:number}|undefined;
 const result=Number(row?.n);
 if(!Number.isSafeInteger(result)||result<0)throw Error("Invalid audit result");
 return result;
}

export function auditCreditLedger(db:DatabaseSync):CreditLedgerAudit{
 const required=[
  "credit_topup_purchases","credit_wallet_ledger","credit_video_reservations"
 ];
 const schemaComplete=required.every(name=>Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
 ).get(name)));
 if(!schemaComplete)return {ok:false,failed:["CREDIT_SCHEMA_MISSING"]};

 const integrity=db.prepare("PRAGMA quick_check(1)").get() as
  {quick_check?:string}|undefined;
 if(integrity?.quick_check!=="ok")
  return {ok:false,failed:["SQLITE_QUICK_CHECK_FAILED"]};

 const failed:string[]=[];
 if(count(db,purchaseEventsSQL)>0)failed.push("CREDIT_PURCHASE_LEDGER_MISMATCH");
 if(count(db,videoEventsSQL)>0)failed.push("CREDIT_VIDEO_LEDGER_MISMATCH");
 if(count(db,orphanEventsSQL)>0)failed.push("CREDIT_ORPHAN_LEDGER_EVENT");
 return {ok:failed.length===0,failed};
}
