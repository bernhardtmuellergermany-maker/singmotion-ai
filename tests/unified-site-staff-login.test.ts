import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("existing website login recognizes verified CMS super admin without another login link",()=>{
 const route=read("app/(site)/api/customer-auth/route.ts");
 const page=read("components/account-panel.tsx");
 assert.match(route,/tryExistingSuperAdminLogin\(req,input\.email,input\.password\)/);
 assert.match(route,/siteStaffStatus\(req\.headers\)/);
 assert.match(route,/store\.login\(input\.email,input\.password\)/);
 assert.ok(route.indexOf("store.login(input.email,input.password)")<
  route.indexOf("tryExistingSuperAdminLogin(req,input.email,input.password)"));
 assert.match(page,/\/api\/customer-auth/);
 assert.doesNotMatch(page,/staff\/login|cms\/staff\/login/);
});
test("CMS staff authentication is role-verified, origin-bound and never elevates ordinary customers",()=>{
 const helper=read("lib/site-staff-auth.ts");
 assert.match(helper,/payload\.auth\(\{headers\}\)/);
 assert.match(helper,/payload\.login\(\{collection:"staff"/);
 assert.match(helper,/hasRole\(result\.user,\["super-admin"\]\)/);
 assert.match(helper,/hasRole\(user,\["super-admin","editor"\]\)/);
 assert.match(helper,/req\.headers\.get\("origin"\)!==origin/);
 assert.match(helper,/httpOnly:true/);
 assert.match(helper,/sameSite:"strict"/);
 assert.doesNotMatch(helper,/SUPER_ADMIN_PASSWORD|ADMIN_DEMO_ACCESS_KEY/);
 const api=read("app/(site)/api/support-admin/route.ts");
 assert.match(api,/adminTestOwner\(user,req\.method,req\.headers,process\.env\)/);
});
