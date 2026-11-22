import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Customer login, OAuth and inactivity never invalidate a CMS login",()=>{
 const cms=read("app/(payload)/api/cms/[...slug]/route.ts");
 const files=["app/(site)/api/customer-auth/route.ts","app/(site)/api/google-auth/callback/route.ts",
  "app/(site)/api/customer-session-activity/route.ts"];
 for(const path of files)assert.doesNotMatch(read(path),/cookies\.delete\("payload-token"\)/,path);
 assert.doesNotMatch(cms,/cookies\.delete\("sm_customer"\)|store\.logout\(token\)/);
 assert.doesNotMatch(read(files[0]),/payload\.auth\(/);
});
test("Customer login never attempts CMS staff authentication",()=>{
 assert.doesNotMatch(read("components/account-panel.tsx"),/\/api\/cms\/staff\/login/);
 assert.match(read("app/(site)/api/customer-auth/route.ts"),/kind:"customer"/);
 assert.match(read("app/(site)/api/[...path]/route.ts"),/Public account wins when CMS and customer cookies coexist/);
});

test("customer sign-outs do not revoke a staff-owned Studio media session",()=>{
 const logout=read("app/(site)/api/unified-logout/route.ts");
 const customer=read("app/(site)/api/customer-auth/route.ts");
 const google=read("app/(site)/api/google-auth/callback/route.ts");
 assert.match(logout,/mediaOwner\.startsWith\("cms-staff-"\)/);
 assert.match(logout,/!mediaOwner\?\.startsWith\("cms-staff-"\)/);
 assert.match(customer,/mediaOwner\?\.startsWith\("customer-"\)/);
 assert.match(customer,/!mediaOwner\?\.startsWith\("cms-staff-"\)/);
 assert.doesNotMatch(google,/owner\.startsWith\("customer-"\)\|\|owner\.startsWith\("cms-staff-"\)/);
 assert.doesNotMatch(customer,/previousOwner\?\.startsWith\("customer-"\)\|\|previousOwner\?\.startsWith\("cms-staff-"\)/);
});

test("guest handoff uses the customer before any independent CMS operator",()=>{
 const source=read("app/(site)/api/customer-guest-import/route.ts");
 const customer=source.indexOf('if(customerEnabled){');
 const staff=source.indexOf('if(!accountOwner&&process.env.CMS_ENABLED==="true"){');
 assert.ok(customer>0&&staff>customer);
 assert.match(source,/studioStaff\(identity\.user,req\.method,req\.headers,process\.env\)/);
 assert.match(source,/session\(req\.cookies\.get\("sm_session"\)\?\.value\)\?\.owner!==accountOwner/);
});

test("site Super Admin logout clears CMS session only for verified staff without customer session",()=>{
 const logout=read("app/(site)/api/unified-logout/route.ts");
 assert.match(logout,/siteStaffStatus\(req\.headers\)/);
 assert.match(logout,/staff=!authenticatedCustomer\?await siteStaffStatus/);
 assert.match(logout,/if\(authenticatedCustomer\)/);
 assert.match(logout,/else if\(staff\)/);
 assert.match(logout,/response\.cookies\.set\("payload-token","",/);
 assert.match(logout,/maxAge:0/);
 assert.match(logout,/revokeMediaSession\(media\)/);
 assert.match(logout,/if\(mediaOwner\?\.startsWith\("cms-staff-"\)\)response\.cookies\.delete\("sm_session"\)/);
 const normal=read("components/account-panel.tsx");
 const menu=read("components/header-account-menu.tsx");
 assert.match(normal,/fetch\("\/api\/unified-logout"/);
 assert.match(menu,/fetch\("\/api\/unified-logout"/);
});
