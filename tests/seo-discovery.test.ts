import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 SEO_CONTENT,SEO_TOPICS,SEO_PUBLIC_PATHS,SEO_GUIDES_HUB,
 resolveSeoTopic,seoPagePath,seoPubliclyIndexable,SITE_ORIGIN
} from "../lib/seo/search-pages.ts";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("English-only helpful search guides have distinct canonical URLs",()=>{
 const pages=new Set<string>();
 const titles=new Set<string>();
 assert.equal(SEO_TOPICS.length,4);
 for(const topic of SEO_TOPICS){
  const page=SEO_CONTENT[topic];
  const canonical=seoPagePath(topic);
  assert.equal(resolveSeoTopic(page.slug),topic);
  assert.equal(canonical,"/help/"+page.slug);
  assert.ok(!pages.has(canonical));pages.add(canonical);
  assert.ok(!titles.has(page.title));titles.add(page.title);
  assert.ok(page.description.length>=75&&page.description.length<180);
  assert.ok(page.intro.length>140);
  assert.equal(page.steps.length,3);
  assert.equal(page.benefits.length,3);
  assert.ok(page.faq.length>=3);
  assert.ok(SEO_PUBLIC_PATHS.includes(canonical));
  assert.ok(!page.intro.includes("free unlimited"));
 }
 assert.equal(pages.size,4);
 assert.equal(resolveSeoTopic("not-a-real-guide"),null);
 assert.equal(SEO_PUBLIC_PATHS.includes(SEO_GUIDES_HUB),true);
 assert.equal(SEO_PUBLIC_PATHS.includes("/help"),true);
 assert.equal(new Set(SEO_PUBLIC_PATHS).size,SEO_PUBLIC_PATHS.length);
 assert.ok(SEO_PUBLIC_PATHS.every(p=>p.startsWith("/")&&!p.includes("?")));
 assert.equal(SEO_PUBLIC_PATHS.some(p=>p==="/de"||p==="/en"||p.startsWith("/de/")||p.startsWith("/en/")),false);
 assert.ok(SITE_ORIGIN.startsWith("https://"));
});

test("public crawler/indexing stays blocked in staging and approval-incomplete Production",()=>{
 const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
 const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:staging,STAGING_AUTH_ENABLED:"false"}),false);
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:production,STAGING_AUTH_ENABLED:"true"}),false);
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:production,PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",PRODUCTION_PUBLIC_ACCESS_ENABLED:"true",STAGING_AUTH_ENABLED:"false"}),false);
 assert.equal(seoPubliclyIndexable({RAILWAY_ENVIRONMENT_ID:"unknown",NODE_ENV:"development"}),false);
});

test("robots, sitemap and proxy never leak private account or checkout URLs",()=>{
 const sitemap=read("app/(site)/sitemap.ts");
 const robots=read("app/robots.ts");
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

test("search guides live only under Help; no German pages or added navigation entries",()=>{
 const component=read("components/seo/search-landing.tsx");
 const home=read("components/immersive-home.tsx");
 const menu=read("components/global-menu.tsx");
 const help=read("components/help-faq.tsx");
 const guideRoute=read("app/(site)/help/[slug]/page.tsx");
 const hub=read("app/(site)/help/ai-video-guides/page.tsx");
 assert.match(component,/<h1>/);
 assert.match(component,/<h2/);
 assert.match(component,/page\.steps/);
 assert.match(component,/page\.faq/);
 assert.match(component,/href="\/studio/);
 assert.match(guideRoute,/generateStaticParams/);
 assert.match(guideRoute,/dynamicParams=false/);
 assert.match(guideRoute,/canonical:seoPagePath/);
 assert.match(hub,/canonical:SEO_GUIDES_HUB/);
 assert.match(help,/href="\/help\/ai-video-guides">AI video guides/);
 assert.doesNotMatch(menu,/AI video guides|KI Video erstellen|href: "\/de"|href: "\/en"/);
 assert.match(home,/sm-immersive-seo-links/,"keep the refined homepage guides section");
 assert.match(home,/href="\/help\/ai-video-guides"/);
 assert.doesNotMatch(home,/href="\/de"|KI-Videos entdecken/);
 assert.doesNotMatch(component,/Deutsche Version|Deutsch|german|locale==="de"/i);
 assert.doesNotMatch(read("lib/seo/search-pages.ts"),/SeoLocale|seoAlternates|slug:"ki-video-erstellen"/);
});
