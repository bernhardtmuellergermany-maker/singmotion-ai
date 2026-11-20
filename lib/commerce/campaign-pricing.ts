import {randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";

export const REGULAR_VIDEO_RATE=25;
export type CampaignStatus="draft"|"scheduled"|"active"|"paused"|"expired"|"archived";
export type CampaignTheme="purple"|"rose"|"gold"|"ice"|"emerald";
export type Campaign={
 id:string;identifier:string;status:CampaignStatus;startUtc:number;endUtc:number;
 creditsPerSecond:number;badgeText:string;heading:string;description:string;
 actionHint:string;ctaText:string;theme:CampaignTheme;accent:string;
 showBadge:boolean;showBanner:boolean;comparisonEvidence:string|null;
 maxCustomerGenerations:number|null;maxCampaignCredits:number|null;
 revision:number;updated:number;
};
export type PublicTariff={
 version:string;campaignId:string|null;identifier:string|null;
 creditsPerSecond:number;regularCreditsPerSecond:25;discountPercent:number|null;
 badgeText:string;heading:string;description:string;actionHint:string;
 ctaText:string;theme:CampaignTheme;accent:string;showBadge:boolean;showBanner:boolean;
 expiresUtc:number|null;
};
const themes=["purple","rose","gold","ice","emerald"] as const;
const accents=["#af65ef","#ff6ea8","#ffd166","#72c3ed","#76d7af"] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validActor=/^[A-Za-z0-9_-]{1,100}$/;
export class CampaignError extends Error{
 constructor(message:string,public readonly status=409){super(message)}
}
export function campaignsEnabled(env:Record<string,string|undefined>){
 return env.CMS_ENABLED==="true"&&env.ADMIN_CAMPAIGNS_ENABLED==="true"&&(
 env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"||
 (env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d"&&
 env.ADMIN_CAMPAIGNS_PRODUCTION_APPROVED==="true"));
}
export function effectiveCampaignStatus(c:Campaign,now=Date.now()):CampaignStatus{
 if(c.status==="archived"||c.status==="paused"||c.status==="draft")return c.status;
 if(now>=c.endUtc)return "expired";
 if(now<c.startUtc)return "scheduled";
 return "active";
}
function string(value:unknown,max:number,required=false){
 if(typeof value!=="string"||value.trim().length>max||
   (required&&!value.trim())||/[<>\u0000-\u001f]/.test(value))
  throw new CampaignError("Ungültiger Kampagnentext oder unerlaubtes Markup.",400);
 return value.trim();
}
function integer(value:unknown,min:number,max:number){
 if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)
  throw new CampaignError("Ungültiger Kampagnenpreis oder Zeitraum.",400);
 return Number(value);
}
export function regularTariff():PublicTariff {
 return {version:"regular-v1",campaignId:null,identifier:null,creditsPerSecond:25,
  regularCreditsPerSecond:25,discountPercent:null,badgeText:"",heading:"",
  description:"",actionHint:"",ctaText:"",theme:"purple",accent:"#af65ef",
  showBadge:false,showBanner:false,expiresUtc:null};
}
export class CampaignPricing{
 constructor(private readonly db:DatabaseSync){
  db.exec(`
   CREATE TABLE IF NOT EXISTS marketing_campaigns(
    id TEXT PRIMARY KEY,identifier TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,start_utc INTEGER NOT NULL,end_utc INTEGER NOT NULL,
    credits_per_second INTEGER NOT NULL CHECK(credits_per_second>=1 AND credits_per_second<=1000),
    badge_text TEXT NOT NULL,heading TEXT NOT NULL,description TEXT NOT NULL,action_hint TEXT NOT NULL,
    cta_text TEXT NOT NULL,theme TEXT NOT NULL,accent TEXT NOT NULL,
    show_badge INTEGER NOT NULL,show_banner INTEGER NOT NULL,comparison_evidence TEXT,
    max_customer_generations INTEGER,max_campaign_credits INTEGER,
    revision INTEGER NOT NULL,updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS marketing_campaign_window_idx ON marketing_campaigns(status,start_utc,end_utc);
   CREATE TABLE IF NOT EXISTS marketing_campaign_versions(
    campaign_id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,
    actor TEXT NOT NULL,created INTEGER NOT NULL,
    PRIMARY KEY(campaign_id,revision)
   );
  `);
 }
 private tx<T>(f:()=>T):T{
  this.db.exec("BEGIN IMMEDIATE");
  try{const v=f();this.db.exec("COMMIT");return v}catch(e){this.db.exec("ROLLBACK");throw e}
 }
 private row(r:Record<string,unknown>):Campaign{
  return {id:String(r.id),identifier:String(r.identifier),status:r.status as CampaignStatus,
   startUtc:Number(r.start_utc),endUtc:Number(r.end_utc),creditsPerSecond:Number(r.credits_per_second),
   badgeText:String(r.badge_text),heading:String(r.heading),description:String(r.description),
   actionHint:String(r.action_hint),ctaText:String(r.cta_text),theme:r.theme as CampaignTheme,
   accent:String(r.accent),showBadge:r.show_badge===1,showBanner:r.show_banner===1,
   comparisonEvidence:r.comparison_evidence===null?null:String(r.comparison_evidence),
   maxCustomerGenerations:r.max_customer_generations===null?null:Number(r.max_customer_generations),
   maxCampaignCredits:r.max_campaign_credits===null?null:Number(r.max_campaign_credits),
   revision:Number(r.revision),updated:Number(r.updated)};
 }
 list():Array<Campaign&{effectiveStatus:CampaignStatus}>{
  return (this.db.prepare("SELECT * FROM marketing_campaigns ORDER BY updated DESC LIMIT 250")
   .all() as Record<string,unknown>[]).map(r=>{
    const campaign=this.row(r);return {...campaign,effectiveStatus:effectiveCampaignStatus(campaign)};
   });
 }
 byId(id:string):Campaign|null{
  if(!uuid.test(id))return null;
  const r=this.db.prepare("SELECT * FROM marketing_campaigns WHERE id=?").get(id) as Record<string,unknown>|undefined;
  return r?this.row(r):null;
 }
 versions(id:string){
  if(!uuid.test(id))return [];
  return this.db.prepare("SELECT revision,actor,created FROM marketing_campaign_versions WHERE campaign_id=? ORDER BY revision DESC LIMIT 100")
   .all(id) as Array<{revision:number;actor:string;created:number}>;
 }
 save(input:Partial<Campaign>&{identifier:string;status:CampaignStatus;startUtc:number;endUtc:number;
  creditsPerSecond:number},actor:string,expectedRevision?:number):Campaign{
  if(!validActor.test(actor))throw new CampaignError("Ungültiger Administrator.",403);
  const status=input.status;
  if(!["draft","scheduled","active","paused","expired","archived"].includes(status))
   throw new CampaignError("Ungültiger Kampagnenstatus.",400);
  const item={
   identifier:string(input.identifier,50,true).toLowerCase(),
   status,startUtc:integer(input.startUtc,0,4102444800000),
   endUtc:integer(input.endUtc,0,4102444800000),
   creditsPerSecond:integer(input.creditsPerSecond,1,1000),
   badgeText:string(input.badgeText??"",32),heading:string(input.heading??"",120),
   description:string(input.description??"",220),actionHint:string(input.actionHint??"",160),
   ctaText:string(input.ctaText??"",60),theme:input.theme??"purple",
   accent:input.accent??"#af65ef",
   showBadge:input.showBadge===true,showBanner:input.showBanner===true,
   comparisonEvidence:input.comparisonEvidence?string(input.comparisonEvidence,500):null,
   maxCustomerGenerations:input.maxCustomerGenerations==null?null:integer(input.maxCustomerGenerations,1,100000),
   maxCampaignCredits:input.maxCampaignCredits==null?null:integer(input.maxCampaignCredits,1,100000000),
  };
  if(!/^[a-z0-9][a-z0-9-]{1,49}$/.test(item.identifier))
   throw new CampaignError("Identifier muss eindeutig und URL-sicher sein.",400);
  if(!themes.includes(item.theme as CampaignTheme)||!accents.includes(item.accent as typeof accents[number]))
   throw new CampaignError("Nur geprüfte Farbvorlagen sind zulässig.",400);
  if(item.endUtc<=item.startUtc||item.endUtc-item.startUtc>366*86400000)
   throw new CampaignError("Ende muss nach Start liegen (maximal 366 Tage).",400);
  if(input.id!==undefined&&!uuid.test(input.id))throw new CampaignError("Ungültige Kampagnen-ID",400);
  if(item.status==="active"||item.status==="scheduled"){
   if(item.endUtc<=Date.now())throw new CampaignError("Abgelaufene Aktion kann nicht veröffentlicht werden.",400);
  }
  return this.tx(()=>{
   const old=input.id?this.byId(input.id):null;
   if(input.id&&!old)throw new CampaignError("Kampagne nicht gefunden.",404);
   if(old&&old.revision!==expectedRevision)throw new CampaignError("Kampagne wurde inzwischen geändert. Bitte neu laden.");
   const id=old?.id??randomUUID();
   if(item.status==="active"||item.status==="scheduled"){
    const conflicting=this.db.prepare(`SELECT id FROM marketing_campaigns
     WHERE id<>? AND status IN ('active','scheduled') AND start_utc<? AND end_utc>? LIMIT 1`)
     .get(id,item.endUtc,item.startUtc);
    if(conflicting)throw new CampaignError("Aktionen mit Preisbindung dürfen sich zeitlich nicht überschneiden.");
   }
   const revision=(old?.revision??0)+1,updated=Date.now();
   this.db.prepare(`INSERT INTO marketing_campaigns
    (id,identifier,status,start_utc,end_utc,credits_per_second,badge_text,heading,description,
     action_hint,cta_text,theme,accent,show_badge,show_banner,comparison_evidence,
     max_customer_generations,max_campaign_credits,revision,updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
     identifier=excluded.identifier,status=excluded.status,start_utc=excluded.start_utc,
     end_utc=excluded.end_utc,credits_per_second=excluded.credits_per_second,
     badge_text=excluded.badge_text,heading=excluded.heading,description=excluded.description,
     action_hint=excluded.action_hint,cta_text=excluded.cta_text,theme=excluded.theme,
     accent=excluded.accent,show_badge=excluded.show_badge,show_banner=excluded.show_banner,
     comparison_evidence=excluded.comparison_evidence,max_customer_generations=excluded.max_customer_generations,
     max_campaign_credits=excluded.max_campaign_credits,revision=excluded.revision,updated=excluded.updated`)
    .run(id,item.identifier,item.status,item.startUtc,item.endUtc,item.creditsPerSecond,
     item.badgeText,item.heading,item.description,item.actionHint,item.ctaText,item.theme,item.accent,
     item.showBadge?1:0,item.showBanner?1:0,item.comparisonEvidence,
     item.maxCustomerGenerations,item.maxCampaignCredits,revision,updated);
   const campaign=this.byId(id)!;
   this.db.prepare("INSERT INTO marketing_campaign_versions VALUES(?,?,?,?,?)")
    .run(id,revision,JSON.stringify(campaign),actor,updated);
   this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
    .run(actor,"campaign-version",id+":"+revision,updated);
   return campaign;
  });
 }
 active(now=Date.now()):PublicTariff{
  const rows=this.db.prepare(`SELECT * FROM marketing_campaigns
   WHERE status IN ('scheduled','active') AND start_utc<=? AND end_utc>?
   ORDER BY start_utc ASC LIMIT 2`).all(now,now) as Record<string,unknown>[];
  if(rows.length>1)throw new CampaignError("Mehrere aktive Tarife. Preisreservierung blockiert.",503);
  if(!rows.length)return regularTariff();
  const c=this.row(rows[0]);
  // A comparison claim needs specific dated legal evidence; otherwise no discount shown.
  const discountPercent=c.creditsPerSecond<REGULAR_VIDEO_RATE&&
   (c.comparisonEvidence?.length??0)>=20
    ?Math.round((1-c.creditsPerSecond/REGULAR_VIDEO_RATE)*100):null;
  return {version:"campaign:"+c.id+":v"+c.revision,campaignId:c.id,
   identifier:c.identifier,creditsPerSecond:c.creditsPerSecond,
   regularCreditsPerSecond:25,discountPercent,badgeText:c.badgeText,
   heading:c.heading,description:c.description,actionHint:c.actionHint,
   ctaText:c.ctaText,theme:c.theme,accent:c.accent,showBadge:c.showBadge,
   showBanner:c.showBanner,expiresUtc:c.endUtc};
 }
 stats(campaignId:string){
  if(!uuid.test(campaignId))throw new CampaignError("Ungültige Kampagnen-ID",400);
  const r=this.db.prepare(`SELECT COUNT(*) generations,
   COALESCE(SUM(t.started_seconds),0) seconds,
   COALESCE(SUM((25-t.credits_per_second)*t.started_seconds),0) discount_credits
   FROM credit_video_tariffs t
   JOIN credit_video_reservations r ON r.project_id=t.project_id
   WHERE t.campaign_id=? AND r.state='settled'`).get(campaignId) as
   {generations:number;seconds:number;discount_credits:number};
  const gifts=this.db.prepare("SELECT COALESCE(SUM(credits),0) total FROM admin_credit_gifts WHERE campaign_id=?")
   .get(campaignId) as {total:number};
  return {settledGenerations:r.generations,settledSeconds:r.seconds,
   discountCredits:r.discount_credits,giftCredits:gifts.total};
 }
}
