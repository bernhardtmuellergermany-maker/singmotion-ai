/** STAGING-only subscription policy. Never trust a plan asserted by the browser. */
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
export type PlanCode="free"|"hobby";
export const PLAN_RULES=Object.freeze({
 free:{code:"free" as const,monthlyPriceCents:0,maxProjects:5,monthlySeconds:0,minSecondsPerVideo:5},
 hobby:{code:"hobby" as const,monthlyPriceCents:499,maxProjects:10,monthlySeconds:30,minSecondsPerVideo:5}
});
const period=(now:number)=>{const d=new Date(now);return d.toISOString().slice(0,7)};
export class PlanLedger{
 constructor(readonly db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS customer_subscriptions(account_id TEXT PRIMARY KEY,plan TEXT NOT NULL,provider TEXT NOT NULL,provider_subscription_id TEXT UNIQUE,status TEXT NOT NULL,current_period_end INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customer_plan_usage(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,period TEXT NOT NULL,seconds INTEGER NOT NULL,state TEXT NOT NULL,provider_attempt_id TEXT UNIQUE,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_customer_plan_usage ON customer_plan_usage(account_id,period,state);`);
 }
 activePlan(accountId:string,now=Date.now()):PlanCode{
  const row=this.db.prepare("SELECT plan,status,current_period_end FROM customer_subscriptions WHERE account_id=?").get(accountId) as {plan:string;status:string;current_period_end:number}|undefined;
  return row?.plan==="hobby"&&["active","trialing"].includes(row.status)&&row.current_period_end>now?"hobby":"free";
 }
 snapshot(accountId:string,now=Date.now()){
  const plan=this.activePlan(accountId,now),rules=PLAN_RULES[plan],month=period(now);
  const row=this.db.prepare("SELECT COALESCE(SUM(seconds),0) AS used FROM customer_plan_usage WHERE account_id=? AND period=? AND state IN ('reserved','consumed')").get(accountId,month) as {used:number};
  return {...rules,period:month,secondsUsed:row.used,secondsRemaining:Math.max(0,rules.monthlySeconds-row.used)};
 }
 /** Reserve before provider submission. Unique provider attempt IDs prevent double billing. */
 reserve(accountId:string,attemptId:string,seconds:number,now=Date.now()){
  if(!Number.isInteger(seconds)||seconds<5||seconds>30||!/^[\w-]{8,128}$/.test(attemptId))throw Error("Invalid video reservation");
  this.db.exec("BEGIN IMMEDIATE");
  try{
   const previous=this.db.prepare("SELECT account_id,seconds FROM customer_plan_usage WHERE provider_attempt_id=?").get(attemptId) as {account_id:string;seconds:number}|undefined;
   if(previous){if(previous.account_id!==accountId||previous.seconds!==seconds)throw Error("Reservation mismatch");this.db.exec("COMMIT");return this.snapshot(accountId,now)}
   const state=this.snapshot(accountId,now);
   if(state.secondsRemaining<seconds)throw Error("Monthly video seconds exceeded");
   this.db.prepare("INSERT INTO customer_plan_usage VALUES(?,?,?,?,?,?,?)").run(randomUUID(),accountId,state.period,seconds,"reserved",attemptId,now);
   this.db.exec("COMMIT");return this.snapshot(accountId,now);
  }catch(e){this.db.exec("ROLLBACK");throw e}
 }
 settle(attemptId:string,charged:boolean){
  const state=charged?"consumed":"released";
  this.db.prepare("UPDATE customer_plan_usage SET state=? WHERE provider_attempt_id=? AND state='reserved'").run(state,attemptId);
 }
}
