import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Customer login, OAuth and inactivity never invalidate a CMS login",()=>{
 const cms=read("app/(payload)/api/cms/[...slug]/route.ts");
 const files=["app/(site)/api/customer-auth/route.ts","app/(site)/api/google-auth/callback/route.ts",
  "app/(site)/api/unified-logout/route.ts","app/(site)/api/customer-session-activity/route.ts"];
 for(const path of files)assert.doesNotMatch(read(path),/cookies\.delete\("payload-token"\)/,path);
 assert.doesNotMatch(cms,/cookies\.delete\("sm_customer"\)|store\.logout\(token\)/);
 assert.doesNotMatch(read(files[0]),/payload\.auth\(/);
});
test("Customer login never attempts CMS staff authentication",()=>{
 assert.doesNotMatch(read("components/account-panel.tsx"),/\/api\/cms\/staff\/login/);
 assert.match(read("app/(site)/api/customer-auth/route.ts"),/kind:"customer"/);
 assert.match(read("app/(site)/api/[...path]/route.ts"),/Public account wins when CMS and customer cookies coexist/);
});
