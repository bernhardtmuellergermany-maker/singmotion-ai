import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {quoteVideoCredits,VIDEO_CREDITS_PER_STARTED_SECOND} from "../lib/commerce/video-credit-quote.ts";
import {stripeCreditTopupsTestEnabled} from "../lib/commerce/credit-wallet.ts";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("25 Credits per started original audio second, never slowed output or provider markup",()=>{
 assert.equal(VIDEO_CREDITS_PER_STARTED_SECOND,25);
 for(const [end,seconds,credits] of [[5,5,125],[5.2,6,150],[6,6,150],
   [6.001,7,175],[6.1,7,175],[10,10,250],[300,300,7500]] as const){
   const quote=quoteVideoCredits(0,end);
   assert.equal(quote?.startedSeconds,seconds);
   assert.equal(quote?.credits,credits);
 }
 assert.equal(quoteVideoCredits(5,10.2)?.credits,150);
 for(const [start,end] of [[0,4.999],[0,300.001],[10,10],[20,15],[-1,10],
    [NaN,10],[0,Infinity]]){
   assert.equal(quoteVideoCredits(start,end),null);
 }
 const wizard=read("components/studio-wizard.tsx");
 const dialog=read("components/generation-dialog.tsx");
 assert.match(wizard,/quoteVideoCredits\(selection\.start,selection\.end\)/);
 assert.match(wizard,/Playback slow-down and longer provider output do not increase/);
 assert.match(wizard,/startedSeconds/);
 assert.doesNotMatch(wizard,/reviewQuote|api\/customer-quote/);
 assert.match(dialog,/creditQuote=quoteVideoCredits\(selection\.start,selection\.end\)/);
 assert.match(dialog,/Estimated video cost/);
 assert.doesNotMatch(dialog,/BytePlus-Basispreis|USD \$\{|0\.07\)\.toFixed/);
 const admin=read("components/admin.tsx");
 assert.match(admin,/25 Credits per started original/);
 assert.doesNotMatch(admin,/USD 0\.07\/second|Observed model cost/);
});

test("global account menu uses Pricing, Credits and one-click Buy Credits anchor",()=>{
 const nav=read("components/header-account-menu.tsx");
 const panel=read("components/account-panel.tsx");
 const buy=read("components/credits-dashboard.tsx");
 assert.match(nav,/href="\/credits#buy-credits"/);
 assert.match(nav,/>Top up credits<\/Link>/);
 assert.match(nav,/href="\/plans"[^>]*>Pricing<\/Link>/);
 assert.match(nav,/href="\/credits"[^>]*>Credits<\/Link>/);
 assert.match(panel,/>Pricing<\/Link>/);
 assert.match(panel,/href="\/credits#buy-credits"/);
 assert.match(buy,/id="buy-credits"/);
 assert.doesNotMatch(nav,/Plans & Pricing|Buy Credits & Usage/);
});

test("credit TEST Checkout is independently enabled on staging but never production",()=>{
 const env={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
  STRIPE_CREDIT_TOPUPS_TEST_ENABLED:"true",STRIPE_SECRET_KEY:"sk_test_fake",
  STRIPE_WEBHOOK_SECRET:"whsec_fake"};
 assert.equal(stripeCreditTopupsTestEnabled(env),true);
 assert.equal(stripeCreditTopupsTestEnabled({...env,STRIPE_CHECKOUT_ENABLED:"false"}),true);
 assert.equal(stripeCreditTopupsTestEnabled({...env,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"}),false);
 assert.equal(stripeCreditTopupsTestEnabled({...env,STRIPE_SECRET_KEY:"sk_live_fake"}),false);
 const route=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(route,/STRIPE_CREDIT_TEST_CHECKOUT_REJECTED/);
 assert.match(route,/Stripe Test Checkout could not be created/);
 assert.match(route,/resolveCreditWalletIdentity/);
 assert.doesNotMatch(route,/STRIPE_LIVE_CHECKOUT_ENABLED/);
});

test("camera guide uses SingMotion dark design and actual Studio prompt controls",()=>{
 const help=read("app/(site)/help/camera-movements/page.tsx");
 const css=read("app/(site)/help/camera-movements/camera-movements.css");
 assert.match(help,/sm-camera-guide/);
 assert.match(css,/background:#0a0b15/);
 assert.match(help,/Back to Studio/);
 assert.match(help,/Quick ideas/);
 assert.match(help,/5–10 seconds/);
 assert.match(help,/500 characters/);
 assert.match(help,/byteplus-sa\/ark-mcp/);
 assert.doesNotMatch(help,/margin: "3rem auto"|BytePlus OmniHuman 1\.5/);
 const guide=read("components/help-faq.tsx");
 assert.match(guide,/up to 500 characters/);
 assert.doesNotMatch(guide,/1,500 characters/);
});

test("Legal pages and electronic withdrawal are English, link to real policies and remain honest",()=>{
 const legal=read("components/legal-policies.tsx");
 const form=read("components/online-withdrawal.tsx");
 const model=read("components/withdrawal-template.tsx");
 const route=read("app/(site)/api/withdrawal/route.ts");
 assert.match(legal,/Privacy policy/);
 assert.match(legal,/Credits, orders and the future generation model/);
 assert.match(legal,/Controller and privacy contact/);
 assert.match(legal,/19 June 2026/);
 assert.match(legal,/2 August 2026/);
 assert.match(legal,/2 December 2026/);
 assert.match(legal,/BytePlus/);
 for(const href of ['/privacy','/cookies','/terms','/withdrawal','/rights','/ai-transparency'])
  assert.ok(legal.includes('href: "'+href+'"'),href);
 assert.match(form,/Confirm withdrawal/);
 assert.match(form,/Withdraw from a contract/);
 assert.match(model,/Model withdrawal form/);
 assert.match(route,/Withdrawal declaration received/);
 for(const [path,content] of [["policy",legal],["form",form],["model",model]] as const){
  assert.doesNotMatch(content,/Verantwortlicher und Datenschutzkontakt|Widerruf bestätigen|Vertrag widerrufen|Du kannst|Bitte bestätige|gehen\.\<\/p\>|Muster-Widerrufsformular/ ,path);
 }
});
