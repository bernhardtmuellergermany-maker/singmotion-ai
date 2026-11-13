import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {adminSupportOverview} from "../lib/commerce/admin-support-overview.ts";
import {SupportCases} from "../lib/commerce/support-cases.ts";

function fixture(){
 const db=new DatabaseSync(":memory:");
 // CommerceStore builds the same schema as the production runtime; the
 // overview itself only reads and never needs a provider or payment client.
 // Reproduce the precise minimal commerce tables required for this query.
 db.exec(`CREATE TABLE customer_orders(
   id TEXT PRIMARY KEY,account_id TEXT,guest_hash TEXT,guest_expiry INTEGER,email TEXT NOT NULL,
   project_id TEXT NOT NULL,price_cents INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,
   quote_evidence TEXT NOT NULL,request_key TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE customer_fulfillment_queue(order_id TEXT PRIMARY KEY,state TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE customer_video_deliveries(order_id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,evidence_hash TEXT NOT NULL,created INTEGER NOT NULL);`);
 new SupportCases(db);
 return db;
}
const stageEnv={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"};
const liveEnv={RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"};
test("Super Admin support overview is read-only with meaningful empty status",()=>{
 const db=fixture();try{
  const state=adminSupportOverview(db,stageEnv,1234567890);
  assert.equal(state.environment,"Staging");
  assert.equal(state.checkedAt,1234567890);
  assert.deepEqual(state.counts,{
   supportAlerts:0,paidUndelivered:0,creditReviews:0,stripeRefundsPending:0,emailsQueued:0});
  assert.deepEqual(state.messages,[]);
 }finally{db.close()}
});
test("status messages distinguish invalid MP4, failed paid delivery, pending Credit and Stripe refunds",()=>{
 const db=fixture();try{
  const paidId=randomUUID(),invalidId=randomUUID(),creditId=randomUUID();
  db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
   .run(paidId,null,null,null,"private@example.invalid",randomUUID(),100,"EUR",
     "paid","private-evidence",randomUUID(),900);
  db.prepare("INSERT INTO customer_fulfillment_queue VALUES(?,'failed',?)").run(paidId,900);
  db.prepare("INSERT INTO credit_video_reservations VALUES(?,?,?,'review',?,?)")
   .run(creditId,"customer:private-id",150,800,800);
  db.prepare(`INSERT INTO support_stripe_refund_intents
    (order_id,checkout_session,amount_cents,actor,reason,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'pending',?,?)`)
   .run(paidId,"cs_test_secret_ref",100,"cms-staff-1","Private reason not for customer display",700,1000);
  db.prepare(`INSERT INTO support_case_mail_outbox
    (event_key,reference,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?)`)
   .run("support-operator:output:"+invalidId,invalidId,"operator@example.invalid",
     "private subject","Private mail contents must never be returned",1100);
  db.prepare(`INSERT INTO support_case_mail_outbox
    (event_key,reference,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?)`)
   .run("support-email:credits-returned:"+creditId,creditId,"buyer@example.invalid",
     "private subject","Private mail contents must never be returned",1150);
  db.prepare("INSERT INTO support_case_events VALUES(?,?,?,?,?,?)")
   .run("resolved:"+invalidId,invalidId,"resolved","cms-staff-1","Private case note",950);
  const state=adminSupportOverview(db,liveEnv,1200);
  assert.equal(state.environment,"Production");
  assert.deepEqual(state.counts,{
   supportAlerts:1,paidUndelivered:1,creditReviews:1,stripeRefundsPending:1,emailsQueued:2});
  assert.ok(state.messages.some(m=>m.text.includes("Invalid MP4")&&m.reference===invalidId&&m.emailState==="queued"));
  assert.ok(state.messages.some(m=>m.text.includes("Credit return")&&m.reference===creditId));
  assert.ok(state.messages.some(m=>m.text.includes("Stripe refund processing")&&m.reference===paidId));
  assert.ok(state.messages.some(m=>m.text.includes("resolved")&&m.reference===invalidId));
  assert.ok(state.messages.every(m=>m.at<=1200));
  const result=JSON.stringify(state);
  for(const sensitive of ["private@example.invalid","operator@example.invalid","buyer@example.invalid",
    "cs_test_secret_ref","Private case note","Private mail contents","cms-staff-1","customer:private-id"])
    assert.ok(!result.includes(sensitive),"Status projection must not leak "+sensitive);
  // A resolved case is excluded from active operator alerts but remains
  // discoverable in the recent history; queued mail is never marked sent.
  db.prepare("INSERT INTO support_cases(reference,case_type,status,note,actor,resolved_at,updated_at) VALUES(?,'studio-project','resolved',?,?,?,?)")
    .run(invalidId,"Private note","cms-staff-1",1300,1300);
  db.prepare("UPDATE support_case_mail_outbox SET sent_at=1500").run();
  const next=adminSupportOverview(db,liveEnv,1600);
  assert.equal(next.counts.supportAlerts,0);
  assert.equal(next.counts.emailsQueued,0);
  assert.ok(next.messages.some(m=>m.reference===invalidId&&m.emailState==="sent"));
 }finally{db.close()}
});
test("Account Settings admin navigation is gated on verified server access and support status needs a protected route",()=>{
 const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
 const page=read("app/(site)/account/settings/page.tsx");
 const api=read("app/(site)/api/support-admin/overview/route.ts");
 const widget=read("components/admin-account-dashboard.tsx");
 const support=read("components/support-admin.tsx");
 assert.match(page,/canShowAdmin=!adminDenied&&\(adminOverview!==null\|\|data\?\.staffPreview===true\)/);
 assert.match(page,/\{canShowAdmin&&<AdminAccountDashboard/);
 assert.match(page,/href="#admin-console"/);
 assert.match(page,/fetch\("\/api\/support-admin\/overview",\{cache:"no-store",credentials:"same-origin"\}\)/);
 assert.match(api,/adminTestOwner\(user,"GET",req.headers,process.env\)/);
 assert.match(api,/if\(!?process.env.CMS_ENABLED/);
 assert.match(api,/return json\(\{error:"Super Admin authorization required"\},403\)/);
 assert.match(api,/new SupportCases\(store.db\)/);
 assert.doesNotMatch(api,/export async function POST/);
 assert.match(widget,/href="\/support-admin"/);
 assert.match(widget,/href="\/promo-admin"/);
 assert.match(widget,/href="\/admin"/);
 assert.match(widget,/https:\/\/www.singmotion.ai\/support-admin/);
 assert.match(widget,/https:\/\/singmotion-ai-staging.up.railway.app\/support-admin/);
 assert.match(widget,/\/support-admin\?id=/);
 assert.match(support,/new URLSearchParams\(window.location.search\).get\("id"\)/);
 assert.doesNotMatch(widget,/refund-credits|refund-stripe|stripeRequest\(/);
});


test("Account Settings anchor sequence follows visible sections, with smooth scroll and reduced-motion fallback",()=>{
 const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
 const page=read("app/(site)/account/settings/page.tsx");
 const css=read("app/(site)/account/settings/account-settings.css");
 const nav=page.slice(page.indexOf('<nav aria-label="Settings sections"'),page.indexOf("</nav>"));
 const content=page.slice(page.indexOf("{data&&<>"));
 const anchors=["profile","security","billing","invoices","privacy","admin-console"];
 const navPositions=anchors.map(id=>nav.indexOf('href="#'+id+'"'));
 const contentPositions=anchors.map(id=>id==="admin-console"?
   content.indexOf('canShowAdmin&&<AdminAccountDashboard'):content.indexOf('id="'+id+'"'));
 assert.ok(navPositions.every(n=>n>=0),"Every section has a visible matching anchor");
 assert.ok(contentPositions.every(n=>n>=0),"Every anchor points to a rendered section");
 for(let i=1;i<anchors.length;i++){
   assert.ok(navPositions[i]>navPositions[i-1],"Sidebar navigation must follow section order: "+anchors[i]);
   assert.ok(contentPositions[i]>contentPositions[i-1],"Sections must follow sidebar order: "+anchors[i]);
 }
 assert.match(css,/html:has\(\.sm-settings-page\)\{scroll-padding-top:82px\}/);
 assert.match(css,/\.sm-settings-page \.sm-settings-section\[id\]\{scroll-margin-top:16px\}/);
 assert.match(css,/@media \(prefers-reduced-motion: no-preference\)\{\s*html:has\(\.sm-settings-page\)\{scroll-behavior:smooth\}/);
 assert.match(css,/@media \(prefers-reduced-motion: reduce\)\{\s*html:has\(\.sm-settings-page\)\{scroll-behavior:auto\}/);
 assert.doesNotMatch(css,/^html\s*\{\s*scroll-behavior:smooth/m,"Do not change unrelated pages");
});


test("Both Super Admin consoles offer a visible stable back link to Account Settings",()=>{
 const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
 const supportPage=read("app/(site)/support-admin/page.tsx");
 const promoPage=read("app/(site)/promo-admin/page.tsx");
 const back=read("components/admin-console-back-link.tsx");
 const css=read("components/admin-console-back-link.module.css");
 assert.match(supportPage,/import \{AdminConsoleBackLink\} from "@\/components\/admin-console-back-link"/);
 assert.match(supportPage,/<AdminConsoleBackLink\/>/);
 assert.match(promoPage,/import \{ AdminConsoleBackLink \} from "@\/components\/admin-console-back-link"/);
 assert.match(promoPage,/<AdminConsoleBackLink\/>/);
 assert.match(back,/href="\/account\/settings#admin-console"/);
 assert.match(back,/Back to Account Settings/);
 assert.match(back,/aria-label="Return to account settings"/);
 assert.doesNotMatch(back,/history\.back\(|router\.back\(/,"Direct-link visits still need a return route");
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(css,/min-height:44px/,"Mobile tap target must be comfortable");
 assert.match(css, /:focus-visible/,"Keyboard users need visible focus");
});
test("Async Account Settings hydration honors direct return links and reduced-motion setting",()=>{
 const page=readFileSync(new URL("../app/(site)/account/settings/page.tsx",import.meta.url),"utf8");
 assert.match(page,/if\(!data\)return/,"Wait until the target sections are mounted");
 assert.match(page,/target==="admin-console"&&!canShowAdmin/,"Do not scroll to unauthorized admin target");
 assert.match(page,/document\.getElementById\(target\)/);
 assert.match(page,/prefers-reduced-motion: reduce/);
 assert.match(page,/scrollIntoView\(/);
 assert.match(page,/cancelAnimationFrame\(frame\)/);
});
