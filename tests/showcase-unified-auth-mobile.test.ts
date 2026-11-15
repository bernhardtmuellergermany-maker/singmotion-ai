import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
function read(path:string){return readFileSync(new URL("../"+path,import.meta.url),"utf8")}

test("Desktop Stunning Creations browses all randomly ordered, explicitly CMS-approved portraits",()=>{
 const home=read("components/immersive-home.tsx");
 const css=read("app/(site)/home-immersive.css");
 assert.match(home,/fetch\("\/api\/showcase\?channel=desktop_portrait"/);
 assert.match(home,/randomDesktopPortraits\(publicPortraits,previous\)/);
 assert.match(home,/const result=\[\.\.\.unseen,\.\.\.already\];/);
 assert.doesNotMatch(home,/const result=\[\.\.\.unseen,\.\.\.already\]\.slice\(0,4\)/);
 assert.match(home,/sm-last-desktop-portraits/);
 assert.match(home,/selected\.slice\(0,4\)\.map\(c=>c\.url\)/);
 assert.match(home,/const visiblePortraitClips=Array\.from\(\{length:4\}/);
 assert.match(home,/portraitClips\[\(portraitOffset\+index\)%portraitClips\.length\]/);
 assert.match(home,/onClick=\{\(\)=>movePortraits\(-1\)\}/);
 assert.match(home,/onClick=\{\(\)=>movePortraits\(1\)\}/);
 assert.match(home,/aria-label="Previous published videos"/);
 assert.match(home,/aria-label="Next published videos"/);
 assert.match(home,/setAudiblePortrait\(null\)/);
 assert.match(home,/\.map\(\(item,i\)=>\<div key=\{item\.url\|\|i\}/);
 assert.match(css,/\.sm-desktop-portrait-nav/);
 assert.match(css,/\.sm-desktop-portrait-carousel/);
});
test("Mobile reels start with audio preference on, tap toggles mute without stopping playback",()=>{
 const home=read("components/immersive-home.tsx");
 const style=read("app/(site)/home-immersive.css");
 assert.match(home,/const \[muted,setMuted\]=useState\(false\)/);
 assert.match(home,/const next=!video\.muted;\s*video\.muted=next;setMuted\(next\)/);
 assert.doesNotMatch(home,/else video\.pause\(\);/);
 assert.doesNotMatch(home,/className="sm-mobile-reel-mute" type="button"/);
 assert.match(style,/\.sm-mobile-reel-content\{bottom:max\(84px/);
 assert.match(style,/\.sm-mobile-reel-mute\{display:none!important;\}/);
});
test("Showcase generated videos can be hidden from every public feed but are never physically removed",()=>{
 const api=read("app/(site)/api/showcase/route.ts");
 const media=read("app/(site)/api/showcase-media/route.ts");
 const cms=read("components/cms/showcase-manager.tsx");
 assert.match(api,/action==="hide-generated"\|\|body\.action==="restore-generated"/);
 assert.match(api,/DELETE FROM public_showcase_entries WHERE attempt_id=\?/);
 assert.match(api,/DELETE FROM public_showcase_selection WHERE attempt_id=\?/);
 assert.match(api,/public_showcase_hidden/);
 assert.match(media,/kind==="video"/);
 assert.match(media,/DELETE FROM public_showcase_uploads WHERE id=\?/);
 assert.match(media,/row\.filename!==id\+suffix/);
 assert.match(cms,/Upload löschen/);
 assert.match(cms,/Ausgeblendete generierte Videos/);
});
test("Customer, Payload staff, and private Studio sessions are exclusive and sign out from shared header",()=>{
 const logout=read("app/(site)/api/unified-logout/route.ts");
 const login=read("app/(payload)/api/cms/[...slug]/route.ts");
 const customer=read("app/(site)/api/customer-auth/route.ts");
 const media=read("app/(site)/api/[...path]/route.ts");
 const menu=read("components/header-account-menu.tsx");
 const account=read("components/account-panel.tsx");
 assert.match(logout,/store\.logout\(customerToken\)/);
 assert.match(logout,/revokeMediaSession\(media\)/);
 assert.match(logout,/response\.cookies\.delete\("payload-token"\)/);
 assert.match(login,/response\.ok/);
 assert.match(login,/store\.logout\(token\)/);
 assert.match(customer,/response\.cookies\.delete\("payload-token"\)/);
 assert.match(media,/commerce\.session\(req\.cookies\.get\("sm_customer"\)/);
 assert.match(media,/if\(!valid\)auth=undefined/);
 assert.match(menu,/\/api\/unified-logout/);
 assert.match(account,/\/api\/unified-logout/);
});
