import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("badge has real spacing from the existing wordmark at mobile and desktop sizes",()=>{
 const css=read("components/campaign-display.css");
 const header=read("components/site-header.tsx");
 assert.match(header,/<CampaignLogoBadge\/>/);
 assert.match(css,/margin:0 0 0 clamp\(12px,1\.5vw,20px\)!important/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(css,/margin-left:10px!important/);
 assert.match(css,/data-theme="beta"/);
 assert.match(css,/\[data-theme="beta"\]::before/);
});
test("marketing editor binds every text field to 3 page previews and 2 distinct viewport widths",()=>{
 const editor=read("components/cms/campaigns-client.tsx");
 const css=read("components/cms/campaigns.css");
 for(const field of ["badgeText","heading","description","actionHint","ctaText"]){
  assert.match(editor,new RegExp('edit\\("'+field+'",'));
  assert.match(editor,new RegExp("selected\\."+field));
 }
 for(const page of ['"home"','"pricing"','"credits"'])assert.ok(editor.includes(page));
 for(const size of ['"desktop"','"mobile"'])assert.ok(editor.includes(size));
 assert.match(css,/\.sm-marketing-preview-desktop/);
 assert.match(css,/\.sm-marketing-preview-mobile/);
 assert.match(css,/max-width:390px/);
 assert.match(css,/data-theme="beta"/);
 assert.match(editor,/BETA · Lilac Glow/);
});
test("actual homepage, Pricing and Credits show live CMS fields and never a stale 25-credit example",()=>{
 const banner=read("components/campaign-display.tsx");
 const hero=read("components/immersive-home.tsx");
 const plans=read("app/(site)/plans/page.tsx");
 const credits=read("app/(site)/credits/page.tsx");
 const server=read("app/(site)/api/credit-tariff/route.ts");
 for(const field of ["badgeText","heading","description","actionHint","ctaText"]){
  assert.ok(banner.includes("tariff."+field),"Missing public campaign text: "+field);
 }
 assert.match(banner,/fetch\("\/api\/credit-tariff"/);
 assert.match(server,/new CampaignPricing\(store\.db\)\.active\(\)/);
 assert.match(hero,/<CampaignOfferLine\/>/);
 assert.match(plans,/<CampaignPricingBanner placement="pricing"\/>/);
 assert.match(plans,/<CurrentVideoRate\/>/);
 assert.doesNotMatch(plans,/250 Credits <small>€2\.50/);
 assert.match(credits,/<CampaignPricingBanner placement="credits"\/>/);
 assert.match(banner,/seconds\*tariff\.creditsPerSecond/);
});
