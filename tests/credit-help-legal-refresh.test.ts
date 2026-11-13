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
 assert.ok(nav.includes('href="/plans"')&&nav.includes('>Pricing</Link>'));
 assert.ok(nav.includes('href="/credits"')&&nav.includes('>Credits</Link>'));
 assert.doesNotMatch(panel,/sm-account-pricing-link|href="\/plans"/);
 assert.match(panel,/bring your music to life with AI-generated videos/);
 assert.match(panel,/Build your private AI music-video workspace/);
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
 assert.doesNotMatch(help,/Back to Studio/);
 assert.match(help,/Help & best practices/);
 assert.match(help,/FAQ/);
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

test("Super Admin account settings show real security route and a safe account deletion request",()=>{
 const page=read("app/(site)/account/settings/page.tsx");
 const api=read("app/(site)/api/customer-settings/route.ts");
 const cms=read("cms/config.ts");
 assert.match(page,/data\.staffPreview&&<section id="security"/);
 assert.match(page,/href="\/admin\/account"/);
 assert.match(page,/Change password in Admin/);
 assert.match(page,/Request account deletion/);
 assert.match(page,/staff account|Super Admin \/ staff/);
 assert.match(page,/window\.confirm/);
 assert.match(page,/mailto:support@singmotion\.ai/);
 assert.match(page,/you must send it yourself/);
 assert.match(cms,/delete: never/);
 assert.match(cms,/password\.length < 20/);
 assert.match(api,/user\.createdAt/);
});
test("Staging Stripe checkout captures sanitized 400 reason and support reference without exposing credentials",()=>{
 const route=read("app/(site)/api/credit-checkout/route.ts");
 const picker=read("components/credit-amount-picker.tsx");
 // Stripe's 2026-09-30 API rejects the old payment_method_types field.
 // Assert on the actual encoded body, not mentions in a migration comment.
 const checkoutForm=route.split("const form=new URLSearchParams({")[1]?.split("});")[0];
 assert.ok(checkoutForm,"Stripe form body must remain present");
 assert.ok(!checkoutForm.includes('"payment_method_types[0]"'),"Stripe 2026 API rejects legacy payment_method_types");
 assert.ok(checkoutForm.includes('"line_items[0][price_data][currency]"'),"EUR price data remains included");
 assert.ok(checkoutForm.includes('"managed_payments[enabled]":"false"'),
  "Staging test top-ups must not opt in to Managed Payments without a reviewed tax code");
 assert.ok(!checkoutForm.includes('"line_items[0][price_data][product_data][tax_code]"'),
  "Do not invent tax codes for unclassified prepaid credits");
 assert.match(checkoutForm,/mode:"payment"/);
 assert.match(checkoutForm,/success_url/);
 assert.match(checkoutForm,/cancel_url/);
 assert.match(route,/request-id/);
 assert.match(route,/Stripe Test Checkout could not be created/);
 assert.match(route,/\[secret\]/);
 assert.match(route,/\[email\]/);
 assert.match(route,/supportReference/);
 assert.match(picker,/Stripe support reference/);
 const wallets=read("lib/commerce/credit-wallet.ts");
 assert.match(wallets,/RAILWAY_ENVIRONMENT_ID===STAGING_ID/);
 assert.doesNotMatch(wallets,/sk_live_.*Stripe/);
});

test("standalone password reset visually matches the sign-in and register experience",()=>{
 const login=read("app/(site)/login/page.tsx");
 const reset=read("app/(site)/account/reset-password/page.tsx");
 const css=read("app/(site)/account/reset-password/reset-password.css");
 const auth=read("components/account-panel.tsx");
 assert.match(login,/sm-standalone-auth/);
 assert.match(reset,/sm-standalone-auth-main/);
 assert.match(reset,/sm-standalone-auth-form/);
 assert.match(reset,/SiteHeader/);
 assert.match(reset,/sm-account-form/);
 assert.match(reset,/sm-carousel-primary/);
 assert.match(css,/linear-gradient/);
 assert.match(css,/sm-reset-password/);
 assert.match(reset,/minLength=\{20\}/);
 assert.match(reset,/Back to sign in/);
 assert.match(reset,/customer-password-reset/);
 assert.doesNotMatch(auth,/sm-account-pricing-link/);
 assert.doesNotMatch(reset,/style=\{\{/);
});
test("Studio video status uses customer Credits and per-job verified reservation state",()=>{
 const status=read("components/generation-status-view.tsx");
 const admin=read("components/super-admin-generation.tsx");
 const workflow=read("lib/live/studio.ts");
 const api=read("app/(site)/api/credit-balance/route.ts");
 assert.match(status,/Video credit authorization/);
 assert.match(status,/Credits charged/);
 assert.match(status,/Credits reserved/);
 assert.match(status,/Credits released/);
 assert.doesNotMatch(status,/providerEstimate|\$0\.07|providerSeconds|USD 0\./);
 assert.match(admin,/creditCharge=\{project\?\.creditCharge\}/);
 assert.match(workflow,/wallet\.reserveVideo\(id,verifiedCreditSubject,quote\.credits\)/);
 assert.match(workflow,/this\.requirePrepaidCredits/);
 assert.match(api,/videoReservations/);
 assert.match(api,/videoReserved/);
});

test("Legal homepage topics explain what customers will find before opening each policy",()=>{
 const content=read("components/legal-policies.tsx");
 const css=read("app/(site)/site-navigation.css");
 assert.match(content,/What to check before uploading a song, a portrait/);
 assert.match(content,/how credits and purchases work/);
 assert.match(content,/How account details, uploaded music and photos/);
 assert.match(content,/sm-legal-topic-intro/);
 assert.match(css,/\.sm-legal-topic li p/);
});
test("Paid order removal requires fresh account password and never deletes billing records",()=>{
 const route=read("app/(site)/api/customer-hide-paid-order/route.ts");
 const settings=read("app/(site)/account/settings/page.tsx");
 const store=read("lib/commerce/store.ts");
 assert.match(route,/store\.session\(/);
 assert.match(route,/store\.verifyCustomerPassword\(/);
 assert.match(route,/applicationOrigin/);
 assert.match(route,/customer_hidden_paid_orders/);
 assert.doesNotMatch(route,/DELETE FROM customer_orders|DROP TABLE customer_orders/);
 assert.match(settings,/Account password/);
 assert.match(settings,/Confirm removal/);
 assert.match(settings,/Invoices and payment records/);
 assert.match(store,/timingSafeEqual\(scryptSync\(password,salt,64\)/);
});


test("all six Legal subpages have keyboard-accessible Back to Legals buttons",()=>{
 const legal=read("components/legal-policies.tsx");
 const info=read("app/(site)/[info]/page.tsx");
 const css=read("app/(site)/site-navigation.css");
 for(const slug of ["privacy","cookies","terms","rights","ai-transparency","withdrawal"]){
  assert.ok(legal.includes(slug+":{")||legal.includes(slug+": {")||legal.includes('"'+slug+'":{'),slug+" must use the shared LegalPolicyPage");
 }
 assert.match(info,/legalSlugs.includes\\(slug\\)/);
 assert.equal((legal.match(/className="sm-legal-back-nav/g)||[]).length,2,"Top and bottom navigation");
 assert.equal((legal.match(/className="sm-legal-back"/g)||[]).length,2,"Each back navigation has a visible button");
 assert.equal((legal.match(/slug==="legal"\\?"\\/"\\:"\\/legal"/g)||[]).length,2,"Every policy navigates to the stable /legal hub");
 assert.equal((legal.match(/"Back to home":"Back to Legals"/g)||[]).length,2);
 assert.match(legal,/aria-label="Return navigation"/);
 assert.match(legal,/aria-label="Return navigation at the end of the page"/);
 assert.match(legal,/ArrowLeft size=\\{17\\} aria-hidden="true"/);
 assert.match(css,/\\.sm-legal-back\\{[^}]*min-height:44px/);
 assert.match(css,/\\.sm-legal-back:focus-visible/);
});
