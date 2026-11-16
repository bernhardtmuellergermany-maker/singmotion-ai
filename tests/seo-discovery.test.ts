import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 SEO_CONTENT,SEO_TOPICS,SEO_PUBLIC_PATHS,resolveSeoTopic,seoPagePath,
 seoAlternates,seoPubliclyIndexable,SITE_ORIGIN
} from "../lib/seo/search-pages.ts";

test("four truthful bilingual search intents have unique canonicals and reciprocal hreflang",()=>{
 const pages=new Set<string>();
 const titles=new Set<string>();
 for(const topic of SEO_TOPICS){
  const alternates=seoAlternates(topic);
  for(const locale of ["de","en"] as const){
   const page=SEO_CONTENT[topic][locale];
   const path=seoPagePath(topic,locale);
   assert.equal(resolveSeoTopic(locale,page.slug),topic);
   assert.ok(!pages.has(path),"repeated canonical "+path);pages.add(path);
   assert.ok(!titles.has(page.title),"repeated title "+page.title);titles.add(page.title);
   assert.ok(page.description.length>=75&&page.description.length<180);
   assert.ok(page.intro.length>140);
   assert.equal(page.steps.length,3);
   assert.equal(page.benefits.length,3);
   assert.ok(page.faq.length>=3);
   assert.equal(alternates[locale],path);
   assert.equal(alternates["x-default"],seoPagePath(topic,"en"));
   assert.ok(!page.intro.includes("free unlimited"));
   assert.ok(SEO_PUBLIC_PATHS.includes(path));
  }
 }
 assert.equal(pages.size,8);
 assert.equal(resolveSeoTopic("de","nicht-vorhanden"),null);
 assert.equal(new Set(SEO_PUBLIC_PATHS).size,SEO_PUBLIC_PATHS.length);
 assert.ok(SEO_PUBLIC_PATHS.every(p=>p.startsWith("/")&&!p.includes("?")));
 assert.ok(SITE_ORIGIN.startsWith("https://"));
});

test("public crawler/indexing stays blocked in staging and approval-incomplete Production",()=>{
 const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
 const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:staging,STAGING_AUTH_ENABLED:"false"}),false);
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:production,STAGING_AUTH_ENABLED:"true"}),false);
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:production,PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",PRODUCTION_PUBLIC_ACCESS_ENABLED:"true",STAGING_AUTH_ENABLED:"false"}),false,
  "SEO public state may never bypass unresolved commerce/backup/legal release");
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:"unknown",NODE_ENV:"development"}),false);
});

test("robots/sitemap require actual public release and do not list wallets or private projects",()=>{
 const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
 const sitemap=read("app/(site)/sitemap.ts");
 const robots=read("app/(site)/robots.ts");
 const proxy=read("proxy.ts");
 assert.match(sitemap,/seoPubliclyIndexable\(\)/);
 assert.match(sitemap,/return \[\]/);
 assert.match(sitemap,/force-dynamic/);
 assert.match(robots,/seoPubliclyIndexable\(\)/);
 assert.match(robots,/disallow:"\/"/);
 assert.match(robots,/\/account\//);
 assert.match(proxy,/stagingDenial/);
 assert.match(proxy,/X-Robots-Tag/);
 for(const forbidden of ["/api","/account","/projects","/credits","/checkout","/studio","/admin","/signin"]){
  assert.ok(!SEO_PUBLIC_PATHS.includes(forbidden));
  assert.equal(SEO_PUBLIC_PATHS.some(path=>path.startsWith(forbidden+"/")),false);
 }
});

test("search pages render semantic helpful content and not generated keyword-doorway URLs",()=>{
 const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
 const component=read("components/seo/search-landing.tsx");
 const home=read("components/immersive-home.tsx");
 const menu=read("components/global-menu.tsx");
 assert.match(component,/<h1>/);
 assert.match(component,/<h2/);
 assert.match(component,/page\.steps/);
 assert.match(component,/page\.faq/);
 assert.match(component,/href=.+\/studio/);
 assert.match(home,/\/en\/ai-music-video-maker/);
 assert.match(home,/\/de/);
 assert.match(menu,/AI video guides/);
 for(const locale of ["de","en"]){
  const route=read("app/(site)/"+locale+"/[slug]/page.tsx");
  assert.match(route,/generateStaticParams/);
  assert.match(route,/dynamicParams=false/);
  assert.match(route,/canonical:seoPagePath/);
  assert.match(route,/seoAlternates/);
 }
});
