import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const css=readFileSync(new URL("../app/(site)/site-navigation.css",import.meta.url),"utf8");
const rule=(selector:string)=>{
 const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 const match=css.match(new RegExp(escaped+"\\s*\\{([^}]+)\\}"));
 assert.ok(match,"Missing header selector "+selector);
 return match[1];
};
test("fixed transparent navigation does not intercept pull-to-refresh drags",()=>{
 const common=css.match(/\.sm-site-header\.home-gallery-header\.sm-carousel-header,[\s\S]*?\.sm-standalone-auth \.sm-site-header\s*\{([^}]+)\}/);
 assert.ok(common);
 assert.match(common[1],/pointer-events:none!important/);
 assert.match(common[1],/touch-action:pan-y!important/);
 assert.match(rule(".sm-site-header .sm-site-header-left"),/pointer-events:none!important/);
 assert.match(rule(".sm-site-header .sm-site-header-left>.sm-wordmark"),/touch-action:pan-y!important/);
 assert.match(rule(".sm-site-header .sm-header-actions"),/pointer-events:none!important/);
 assert.match(rule(".sm-site-header .sm-header-actions>*"),/pointer-events:auto!important/);
 assert.match(rule(".sm-output-page>.sm-site-header"),/pointer-events:none!important/);
});


test("all routes use the same viewport-anchored global header geometry as home",()=>{
 const common=css.match(/\.sm-site-header\.home-gallery-header\.sm-carousel-header,[\s\S]*?\.sm-standalone-auth \.sm-site-header\s*\{([^}]+)\}/);
 assert.ok(common);
 assert.match(common[1],/left:0!important/);
 assert.match(common[1],/right:0!important/);
 assert.doesNotMatch(common[1],/left:auto!important|right:auto!important/);
});
