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
 assert.doesNotMatch(css,/\[data-theme="beta"\]::before/);
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


test("reference pill follows original CTA and aligns with evidence-backed pricing",()=>{
 const banner=read("components/campaign-display.tsx");
 const css=read("components/campaign-display.css");
 const hero=read("components/immersive-home.tsx");
 const homeCss=read("app/(site)/home-immersive.css");
 const preview=read("components/cms/campaigns-client.tsx");
 const previewCss=read("components/cms/campaigns.css");
 const cta='<Link className="sm-immersive-cta" href="/studio?new=1">Create your music video <ArrowRight size={20}/></Link>';
 assert.equal(hero.split(cta+"\n     <CampaignOfferLine/>").length-1,2);
 assert.match(homeCss,/\.sm-immersive-cta\{[^}]*min-height:54px;min-width:min\(320px,100%\)/);
 for(const token of ["<Rocket size={20}","sm-campaign-offer-divider",
   "sm-campaign-offer-current","sm-campaign-offer-discount",
   "sm-campaign-offer-regular","<Clock3 size={15}",
   "sm-campaign-offer-meta"]){
  assert.ok(banner.includes(token),"Missing offer item "+token);
 }
 assert.match(banner,/tariff\.discountPercent!==null&&/);
 assert.match(banner,/tariff\.creditsPerSecond<tariff\.regularCreditsPerSecond/);
 assert.match(banner,/discounted&&<>/);
 assert.match(css,/\.sm-immersive-home \.sm-campaign-offer-line\{/);
 assert.match(css,/padding:11px 20px/);
 assert.match(css,/width:min\(560px,100%\)/);
 assert.match(css,/border-radius:999px/);
 assert.match(css,/sm-mobile-reel-content \.sm-campaign-offer-block/);
 assert.ok(banner.indexOf('</aside>')<banner.indexOf('className="sm-campaign-offer-meta"'));
 assert.ok(preview.indexOf('sm-marketing-preview-primary')<preview.indexOf('sm-marketing-preview-offer-block'));
 assert.match(preview,/sm-marketing-preview-offer-regular/);
 assert.match(preview,/sm-marketing-preview-offer-hint/);
 assert.match(preview,/Uhr-Hinweis unter der Angebotsleiste/);
 assert.doesNotMatch(preview,/sm-marketing-preview-offer-detail/);
 assert.doesNotMatch(banner,/sm-campaign-offer-details/);
 assert.doesNotMatch(css,/\[data-theme="beta"\]::before/);
 assert.match(previewCss,/\.sm-marketing-preview-mobile\.sm-marketing-preview-home \.sm-marketing-preview-offer/);
});
