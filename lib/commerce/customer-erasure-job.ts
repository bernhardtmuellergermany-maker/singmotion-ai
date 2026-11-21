/**
 * Durable customer erasure request. A request freezes account access, but is
 * NOT itself a claim that refunds or media deletion have completed.
 *
 * Only an authenticated, freshly password-verified route may invoke begin.
 * The opaque status bearer token is generated server-side and stored hashed.
 */
import {createHash,randomBytes} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import type {CommerceStore} from "./store.ts";
import {queueCustomerErasureCompletionEmail} from "./customer-erasure-completion-email.ts";

export type ErasureJobState="requested"|"refunding"|"removing-media"|"removing-data"|"completed"|"needs-attention";
export type ErasureJob={
 accountId:string;state:ErasureJobState;createdAt:number;updatedAt:number;
 attempts:number;issue:string|null;completedAt:number|null;
};
const hash=(raw:string)=>createHash("sha256").update(raw).digest("hex");
const states=new Set<ErasureJobState>([
 "requested","refunding","removing-media","removing-data","completed","needs-attention"
]);
export function ensureCustomerErasureJobs(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS customer_erasure_jobs(
  account_id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL CHECK(state IN
   ('requested','refunding','removing-media','removing-data','completed','needs-attention')),
  created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,issue TEXT,completed_at INTEGER
 )`);
}
function map(row:Record<string,unknown>):ErasureJob{
 const state=row.state as ErasureJobState;
 if(!states.has(state))throw Error("Unknown erasure state");
 return {accountId:String(row.account_id),state,createdAt:Number(row.created_at),
  updatedAt:Number(row.updated_at),attempts:Number(row.attempts),
  issue:typeof row.issue==="string"?row.issue:null,
  completedAt:row.completed_at===null?null:Number(row.completed_at)};
}
export function erasureInProgress(db:DatabaseSync,accountId:string):boolean{
 // The CommerceStore constructor creates this table at startup; older
 // databases encountered outside that constructor must fail safely.
 const hasTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customer_erasure_jobs'").get();
 if(!hasTable)return false;
 const row=db.prepare("SELECT state FROM customer_erasure_jobs WHERE account_id=?")
 .get(accountId) as {state:string}|undefined;
 return Boolean(row&&row.state!=="completed");
}
export function readErasureJob(db:DatabaseSync,accountId:string):ErasureJob|null{
 ensureCustomerErasureJobs(db);
 const row=db.prepare("SELECT * FROM customer_erasure_jobs WHERE account_id=?")
  .get(accountId) as Record<string,unknown>|undefined;
 return row?map(row):null;
}
export function erasureJobByToken(db:DatabaseSync,token:string):ErasureJob|null{
 if(typeof token!=="string"||!/^[A-Za-z0-9_-]{40,90}$/.test(token))return null;
 ensureCustomerErasureJobs(db);
 const row=db.prepare("SELECT * FROM customer_erasure_jobs WHERE token_hash=?")
  .get(hash(token)) as Record<string,unknown>|undefined;
 return row?map(row):null;
}
export function beginCustomerErasure(store:CommerceStore,accountId:string):{
 token:string;job:ErasureJob
}{
 if(!/^[a-f0-9-]{36}$/i.test(accountId))throw Error("Invalid customer account");
 const token=randomBytes(48).toString("base64url");
 const now=Date.now();
 store.db.exec("BEGIN IMMEDIATE");
 try{
  ensureCustomerErasureJobs(store.db);
  const account=store.db.prepare("SELECT id,email FROM customer_accounts WHERE id=?")
   .get(accountId) as {id:string;email:string}|undefined;
  if(!account)throw Error("Customer account missing");
  const existing=readErasureJob(store.db,accountId);
  if(existing)throw Error("Erasure already requested; use your existing deletion status link");
  store.db.prepare(`INSERT INTO customer_erasure_jobs
    (account_id,token_hash,state,created_at,updated_at)
    VALUES(?,?,'requested',?,?)`).run(accountId,hash(token),now,now);
  queueCustomerErasureCompletionEmail(store.db,accountId,account.email);
  // Immediately invalidate all known customer login tokens. The shared
  // session and login methods also deny access while a job is pending.
  store.db.prepare("DELETE FROM customer_sessions WHERE account_id=?").run(accountId);
  const job=readErasureJob(store.db,accountId)!;
  store.db.exec("COMMIT");
  return {token,job};
 }catch(e){store.db.exec("ROLLBACK");throw e;}
}
const transitions:Readonly<Record<ErasureJobState,ReadonlySet<ErasureJobState>>>={
 "requested":new Set(["refunding","removing-media","needs-attention"]),
 "refunding":new Set(["removing-media","needs-attention"]),
 "removing-media":new Set(["removing-data","needs-attention"]),
 "removing-data":new Set(["completed","needs-attention"]),
 "needs-attention":new Set(["refunding","removing-media","removing-data"]),
 "completed":new Set()
};
export function advanceErasureJob(db:DatabaseSync,accountId:string,state:ErasureJobState,issue:string|null=null){
 if(issue!==null&&!/^[A-Z0-9_]{3,80}$/.test(issue))throw Error("Invalid safe issue code");
 ensureCustomerErasureJobs(db);
 const prior=readErasureJob(db,accountId);
 if(!prior||!transitions[prior.state].has(state))throw Error("Invalid erasure state change");
 if(state==="completed"&&db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(accountId))
  throw Error("Cannot mark erasure complete while customer identity still exists");
 const stamp=Date.now();
 const result=db.prepare(`UPDATE customer_erasure_jobs SET state=?,updated_at=?,
  attempts=attempts+1,issue=?,completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END
  WHERE account_id=? AND state=?`)
  .run(state,stamp,issue,state,stamp,accountId,prior.state);
 if(result.changes!==1)throw Error("Concurrent erasure state change");
 return readErasureJob(db,accountId)!;
}
