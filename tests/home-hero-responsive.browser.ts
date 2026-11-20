/** Isolated Chromium mobile + compact-desktop hero geometry regression.
 * Uses real responsive CSS and representative CMS presentation. Never visits a
 * live site, signs in, pays, or makes provider/network requests.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chromium} from "@playwright/test";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const css=read("app/(site)/home-immersive.css")+"\n"+read("components/campaign-display.css");
const markup="<div class=\"sm-immersive-home\"><div class=\"sm-immersive-first-screen\"><main class=\"sm-immersive-hero\">\n<div class=\"sm-immersive-desktop-intro\">\n<h1>Turn your song into a <span>music video.</span></h1><p>With SingMotion AI — your song, your performance.</p>\n<a href=\"/studio?new=1\" class=\"sm-immersive-cta\">Create your music video →</a>\n<div class=\"sm-campaign-offer-block\"><a class=\"sm-campaign-offer-line\" href=\"/login\">\n<span class=\"sm-campaign-offer-identity\"><svg width=\"20\" height=\"20\" aria-hidden=\"true\"></svg><strong class=\"sm-campaign-offer-name\">BETA Offer</strong></span>\n<span class=\"sm-campaign-offer-divider\"></span><strong class=\"sm-campaign-offer-current\">0,10 € / sec</strong>\n<span class=\"sm-campaign-offer-discount\">60% OFF</span><del class=\"sm-campaign-offer-regular\">0,25 € / sec</del>\n</a><div class=\"sm-campaign-offer-meta\"><small class=\"sm-campaign-offer-hint\">◷ Limited-time offer</small></div></div></div>\n<div class=\"sm-mobile-reel-content\">\n<h1>Turn your song into a music video.</h1><p>Make your music come alive with SingMotion AI.</p>\n<a href=\"/studio?new=1\" class=\"sm-immersive-cta\">Create your music video →</a>\n<div class=\"sm-campaign-offer-block\"><a class=\"sm-campaign-offer-line\" href=\"/login\">\n<span class=\"sm-campaign-offer-identity\"><svg width=\"20\" height=\"20\" aria-hidden=\"true\"></svg><strong class=\"sm-campaign-offer-name\">BETA Offer</strong></span>\n<span class=\"sm-campaign-offer-divider\"></span><strong class=\"sm-campaign-offer-current\">0,10 € / sec</strong>\n<span class=\"sm-campaign-offer-discount\">60% OFF</span><del class=\"sm-campaign-offer-regular\">0,25 € / sec</del>\n</a><div class=\"sm-campaign-offer-meta\"><small class=\"sm-campaign-offer-hint\">◷ Limited-time offer</small></div></div></div>\n<span class=\"sm-mobile-swipe-hint\">↑ Swipe up</span>\n<a class=\"sm-immersive-scroll-cue\" href=\"#showcase\">scroll</a>\n</main></div></div>";
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?
 {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
try{
 const page=await browser.newPage();
 await page.route("**/*",route=>route.abort());
 const html="<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"+
  "<style>*{box-sizing:border-box}html,body{margin:0;color:white;font-family:Arial,sans-serif}a{color:white}</style>"+
  "<style>"+css+"</style></head><body>"+markup+"</body></html>";
 await page.setContent(html,{waitUntil:"domcontentloaded"});
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,760],[768,600],[1024,680],[1280,900]]){
  await page.setViewportSize({width,height});
  const selector=width<=760?".sm-mobile-reel-content":".sm-immersive-desktop-intro";
  const actual=await page.evaluate((selector:string)=>{
   const parent=document.querySelector(selector)!;
   const a=parent.querySelector(".sm-immersive-cta")!.getBoundingClientRect();
   const b=parent.querySelector(".sm-campaign-offer-block")!.getBoundingClientRect();
   return {
    cta:{top:a.top,bottom:a.bottom,height:a.height},
    offer:{top:b.top,bottom:b.bottom,left:b.left,right:b.right},
    scrollHidden:getComputedStyle(document.querySelector(".sm-immersive-scroll-cue")!).display==="none",
    swipeHidden:getComputedStyle(document.querySelector(".sm-mobile-swipe-hint")!).display==="none",
   };
  },selector);
  const desc=width+"x"+height+": "+JSON.stringify(actual);
  assert.ok(actual.cta.height>=49,"CTA kept its original tap target: "+desc);
  assert.ok(actual.cta.top>=48,"CTA stays below the fixed header: "+desc);
  assert.ok(actual.cta.bottom<=height-3,"CTA remains visible: "+desc);
  assert.ok(actual.offer.top>=actual.cta.bottom-1,"Offer stays below CTA: "+desc);
  assert.ok(actual.offer.bottom<=height-3,"Offer and clock hint remain visible: "+desc);
  assert.ok(actual.offer.left>=-1&&actual.offer.right<=width+1,"Offer fits width: "+desc);
  if(width<=1199||height<=780)assert.ok(actual.scrollHidden,"Compact screen hides scroll decoration: "+desc);
  if(width<=430||height<=700)assert.ok(actual.swipeHidden,"Compact screen hides swipe hint: "+desc);
  console.log("PASS: hero CTA/offer geometry "+width+"x"+height);
 }
 await page.close();
}finally{await browser.close();}
