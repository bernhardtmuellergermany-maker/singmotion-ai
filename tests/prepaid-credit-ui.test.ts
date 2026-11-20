import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
import {creditTone,estimatedRemainingVideoSeconds} from "../lib/commerce/credit-display.ts";
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
test("real account colors",()=>{assert.equal(creditTone(null),"unknown");assert.equal(creditTone(0),"critical");assert.equal(creditTone(249),"critical");assert.equal(creditTone(250),"low");assert.equal(creditTone(999),"low");assert.equal(creditTone(1000),"healthy");});
test("authenticated, account-scoped, read-only balance",()=>{
 const api=read("app/(site)/api/credit-balance/route.ts"),auth=read("lib/commerce/credit-wallet-auth.ts");
 assert.match(api,/resolveCreditWalletIdentity\(req,store\)/);assert.match(api,/WHERE account_id=\?/);
 assert.match(api,/private, no-store/);assert.doesNotMatch(api,/staffPreview|testCredits|export async function POST/);
 assert.match(auth,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(auth,/subject:"super-admin:"\+userId/);
});
test("super-admin and customer share the same wallet menu; usage lives under credits",()=>{
 const menu=read("components/header-account-menu.tsx"),dashboard=read("components/credits-dashboard.tsx");
 assert.match(menu,/identity==="customer"\|\|identity==="super-admin"/);
 assert.match(menu,/fetch\("\/api\/account-credit-summary"/);assert.match(menu,/href="\/credits"/);
 assert.doesNotMatch(menu,/href="\/usage"|TEST ONLY|previewCredits|Credit test view/);
 assert.match(dashboard,/id="usage"/);assert.match(dashboard,/legacyOrders/);assert.match(dashboard,/Equivalent only/);
 assert.doesNotMatch(dashboard,/admin-preview|testCredits|Simuliertes/);
});
test("Pricing opens Stripe only for the authenticated, server-approved credit buyer",()=>{
 const plans=read("app/(site)/plans/page.tsx");
 const picker=read("components/credit-amount-picker.tsx");
 const balance=read("app/(site)/api/credit-balance/route.ts");
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(plans,/CreditAmountPicker discoverAvailability/);
 assert.match(plans,/<CurrentVideoRate\/>/);
 assert.match(plans,/<CampaignPricingBanner placement="pricing"\/>/);
 assert.doesNotMatch(plans,/Live credit purchasing is not available yet/);
 assert.match(picker,/fetch\("\/api\/credit-balance",\{cache:"no-store",credentials:"same-origin"\}\)/);
 assert.match(picker,/const canPurchase=discoverAvailability\?checkoutAccess\.state==="ready"&&checkoutAccess\.purchaseEnabled:purchaseEnabled/);
 assert.match(picker,/data\.testMode!==checkoutTestMode/);
 assert.match(picker,/Sign in to buy Credits/);
 assert.match(picker,/Verify email to buy Credits/);
 assert.match(picker,/Credit purchases are not yet available for this account/);
 assert.match(picker,/api\/credit-checkout/);
 assert.match(picker,/Stripe Test Mode/);
 assert.doesNotMatch(picker,/api\/stripe-checkout/);
 assert.match(balance,/purchaseEnabled:\(testCheckout\|\|liveCheckout\)/);
 assert.match(checkout,/if\(!testMode&&!liveMode\)/);
 assert.match(checkout,/resolveCreditWalletIdentity\(req,store\)/);
});

test("prepared operator project with insufficient wallet credits shows actionable shortage, never progress",()=>{
 const view=read("components/generation-status-view.tsx");
 const status=read("components/super-admin-generation.tsx");
 const workflow=read("lib/live/studio.ts");
 assert.match(workflow,/INSUFFICIENT_CREDITS/);
 assert.match(status,/fetch\("\/api\/credit-balance"/);
 assert.match(status,/availableCredits<project\.creditCharge\.credits/);
 assert.match(status,/if\(shortage\)progress="credits-needed"/);
 assert.match(view,/Not enough Credits/);
 assert.match(view,/No Credits were charged/);
 assert.match(view,/href=\{creditTopupHref\}/);
 assert.match(view,/progress!=="credits-needed"/);
 assert.match(status,/project\?\.state==="prepared"/);
 assert.match(status,/sourceDraftId/);
 assert.match(status,/resumeHref/);
 assert.match(status,/creditTopupHref=\{creditsHref\}/);
});


test("audio trim stays within a selection-aware timeline at desktop and mobile widths",()=>{
 const waveform=read("components/waveform.tsx");
 const style=read("app/(site)/studio-refinement.css");
 assert.match(waveform,/const selectionAwareStart = dragging \? preferredViewStart/);
 assert.match(waveform,/Math\.max\(end - viewSpan, Math\.min\(start, preferredViewStart\)\)/);
 assert.match(waveform,/Math\.max\(0, Math\.min\(maximumViewStart, selectionAwareStart\)\)/);
 assert.match(style,/\.sm-new-wave-card \.wave-strip\{[\s\S]*?clip-path:inset\(-32px 0 -32px 0\)/);
});
test("mobile generation status never renders after the fixed action bar",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const css=read("app/(site)/studio-refinement.css");
 const status=wizard.indexOf('className="sm-review-payment-note sm-review-starting-status"');
 const nav=wizard.indexOf('className="sm-studio-navigation sm-new-navigation"');
 assert.ok(status>0&&nav>status,"Progress message must precede the fixed navigation");
 assert.match(css,/\.flow-main > \.sm-review-starting-status/);
 assert.match(css,/margin-bottom:calc\(115px \+ env\(safe-area-inset-bottom,0px\)\)!important/);
});

test("Studio credit warning matches the 860px review width without desktop overflow",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const css=read("app/(site)/studio-refinement.css");
 assert.match(wizard,/\<CustomerFeedback notice=\{wizardNotice\}/);
 assert.match(css,/\.flow-main > \.sm-customer-feedback\{[\s\S]*?width:min\(100%,860px\);[\s\S]*?max-width:860px;[\s\S]*?align-self:center;[\s\S]*?margin:12px auto 18px;/);
 assert.match(css,/\.sm-review-checkout\{\s*width:min\(100%,860px\);/);
});

test("credit estimator reuses Studio's credit tariff and does not show duplicate signed-out copy",()=>{
 const picker=read("components/credit-amount-picker.tsx");
 const css=read("components/credit-amount-picker.css");
 const plans=read("app/(site)/plans/plans.css");
 assert.match(picker,/fetch\("\/api\/credit-tariff"/);
 assert.match(picker,/Math\.floor\(credits\/creditsPerSecond\)/);
 assert.match(picker,/Estimated AI Video Seconds/);
 assert.match(picker,/Individual video limits apply/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(picker,/Sign in to check if Credit checkout is available for your account/);
 assert.match(picker,/!\(discoverAvailability&&checkoutAccess\.state==="signed-out"\)/);
 assert.match(plans,/\.sm-plan-single \.sm-plan-action\{max-width:none;width:100%;min-height:65px/);
});
test("abandoned Stripe checkouts remain persisted but are absent from customer purchase history",()=>{
 const wallet=read("lib/commerce/credit-wallet.ts");
 const dashboard=read("components/credits-dashboard.tsx");
 assert.match(wallet,/credit_topup_purchases WHERE subject=\? AND status IN \('paid','reversed'\)/);
 assert.match(dashboard,/settledPurchases=balance\?\.purchases\.filter\(p=>p\.status==="paid"\|\|p\.status==="reversed"\)/);
 assert.doesNotMatch(dashboard,/Payment pending/);
});

test("account menu estimates affordable whole video seconds using the live campaign tariff",()=>{
 const menu=read("components/header-account-menu.tsx");
 const css=read("components/header-account-menu.css");
 const api=read("app/(site)/api/account-credit-summary/route.ts");
 assert.match(menu,/fetch\("\/api\/account-credit-summary",\{cache:"no-store",credentials:"same-origin"\}\)/);
 assert.doesNotMatch(menu,/fetch\("\/api\/credit-tariff"/);
 assert.match(api,/resolveCreditWalletIdentity\(req,store\)/);
 assert.match(api,/CampaignPricing\(store\.db\)\.active\(\)/);
 assert.match(api,/wallet\.total\(identity\.subject\)-wallet\.reserved\(identity\.subject\)/);
 assert.match(api,/private, no-store/);
 assert.doesNotMatch(api,/wallet\.entries\(|wallet\.purchases\(|customer_orders/);
 assert.match(menu,/if\(inFlight\)\{queued=true;return;\}/);
 assert.match(menu,/setAvailableCredits\(result\.availableCredits\);\s*setCreditsPerSecond\(result\.creditsPerSecond\)/);
 assert.match(menu,/estimatedRemainingVideoSeconds/);
 assert.match(menu,/title=\{creditsPerSecond\+" Credits per started video second"\}/);
 assert.match(menu,/≈ \{new Intl\.NumberFormat\("en-GB"\)\.format\(remainingSeconds\)\} s left/);
 assert.match(css,/\.sm-account-credit-amount\{display:flex;align-items:baseline;flex-wrap:wrap/);
 assert.match(css,/\.sm-account-credit-seconds\{font-size:12px/);
 assert.match(menu,/window\.setInterval\(\(\)=>\{if\(document\.visibilityState==="visible"\)refresh\(\)\},60_000\)/);
 assert.equal(estimatedRemainingVideoSeconds(525,9),58,"beta campaign at 9 credits/sec");
 assert.equal(estimatedRemainingVideoSeconds(525,25),21,"regular tariff at 25 credits/sec");
 assert.equal(estimatedRemainingVideoSeconds(9,9),1);
 assert.equal(estimatedRemainingVideoSeconds(8,9),0);
 assert.equal(estimatedRemainingVideoSeconds(0,9),0);
 for(const [credits,rate] of [[525,null],[null,9],[-1,9],[525,0],[525,1001],[1.5,9],[525,9.5]] as const)
  assert.equal(estimatedRemainingVideoSeconds(credits,rate),null,"invalid or unavailable price/balance");
});
