import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("global menu contains exactly the four clear destinations", () => {
  const source = read("components/global-menu.tsx");
  const links = [...source.matchAll(/\{ href: "(\/[^"]+)", label: "([^"]+)" \}/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(links, [
    ["/videos", "Videos"],
    ["/help", "Help"],
    ["/legal", "Legals"],
    ["/contact", "Contact"],
  ]);
});

test("pricing is accessible from the account menu, not the general navigation", () => {
  const menu = read("components/global-menu.tsx");
  const accountMenu = read("components/header-account-menu.tsx");
  const accountPanel = read("components/account-panel.tsx");
  assert.doesNotMatch(menu, /\/plans|Pricing/);
  assert.match(accountMenu, /<Link href="\/plans"/);
  assert.match(accountMenu, />Pricing<\/Link>/);
  assert.doesNotMatch(accountPanel, /href="\/plans"/);
});

test("legal topics retain privacy, consumer and AI policies", () => {
  const legal = read("components/legal-policies.tsx");
  for (const label of ["Legal & privacy", "Terms & consumer rights", "AI & media rights"]) {
    assert.ok(legal.includes(label), `missing topic: ${label}`);
  }
  for (const route of ["/privacy", "/cookies", "/terms", "/withdrawal", "/rights", "/ai-transparency"]) {
    assert.ok(legal.includes(`href: "${route}"`), `missing legal route: ${route}`);
  }
  assert.match(legal, /href: "#imprint"/);
});

test("homepage navigation dropdown stays outside isolated video viewport and above moving clips",()=>{
 const page=read("components/immersive-home.tsx");
 const styles=read("app/(site)/site-navigation.css");
 const header=page.indexOf('<SiteHeader className="sm-immersive-header"/>');
 const viewport=page.indexOf('<div ref={firstScreen}');
 assert.ok(header>=0&&viewport>=0&&header<viewport,"Header must precede clipped hero viewport");
 assert.match(styles,/\.sm-immersive-home>\.sm-immersive-header\s*\{/);
 assert.match(styles,/\.sm-site-header \.sm-header-actions>\.sm-global-menu>\.sm-global-menu-list\s*\{/);
 assert.match(styles,/background:#181427!important/);
 assert.match(styles,/position:fixed!important/);
});


test("unreleased Projects stays CMS Super Admin only across page/API/menu",()=>{
 const auth=read("lib/music-video/auth.ts");
 const menu=read("components/global-menu.tsx");
 const page=read("app/(site)/projects/page.tsx");
 const detail=read("app/(site)/projects/[id]/page.tsx");
 const api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.match(auth,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(auth,/if\(store\.session\(customerToken\)\)return null/);
 assert.match(menu,/setMusicEnabled\(false\)/);
 assert.match(menu,/current===serial/);
 assert.match(auth,/CMS_ENABLED!=="true"/);
 assert.doesNotMatch(auth,/MUSIC_VIDEO_CUSTOMER_ENABLED|return "customer:"/);
 assert.match(menu,/fetch\("\/api\/music-video"/);
 assert.doesNotMatch(menu,/auth\?\.authenticated&&auth\.kind==="customer"|staffRole==="super-admin"/);
 assert.match(menu,/musicEnabled&&<Link href="\/projects"/);
 for(const s of [page,detail,api])assert.match(s,/musicPrincipal\(/);
 assert.match(api,/if\(!owner\)throw new MusicError\("Music Video Builder access denied\.",403\)/);
});

test("Projects offers owned completed Lip Sync insertion and separate user video uploads",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes("Insert Lip Sync"));
 assert.ok(editor.includes("Upload own video"));
 assert.ok(editor.includes('await ensureSession()'));
 assert.ok(editor.includes('addClip(a,track,source.sourceStartMs)'));
 assert.ok(editor.includes('if(track!==null)addClip(result.asset,track,playhead)'));
 assert.ok(editor.includes('filter==="Uploads"&&a.kind==="imported"'));
 assert.ok(api.includes('section==="lip-sync"'));
 assert.ok(api.includes('logged?.owner!=="cms-staff-"+owner.slice(6)'));
 assert.ok(api.includes('service.list(logged.owner).filter(p=>p.outputReady&&!p.hidden)'));
 assert.ok(api.includes('service.trashedAt(ref,logged.owner)!==null'));
 assert.ok(api.includes('await service.output(ref,logged.owner)'));
 assert.ok(api.includes('if(!media.streams.some(v=>v.codec_type==="video"))'));
});
