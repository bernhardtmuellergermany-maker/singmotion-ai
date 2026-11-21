import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CommerceStore} from "../lib/commerce/store.ts";
import {googleOnlyDeletionAccount,recentlyVerifiedGoogleDeletion} from "../lib/commerce/customer-deletion-reauth.ts";
import {readFileSync} from "node:fs";

test("Google-only deletion requires newly verified Google OAuth session tied to same customer",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"sm-google-erasure-"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"));
 try{
  const verified=store.googleLogin("123456789012","oauth-only@example.test");
  const other=store.googleLogin("123456789013","another@example.test");
  const passwordId=store.register("password@example.test","safe password long enough");
  const now=Date.now();
  assert.equal(googleOnlyDeletionAccount(store.db,verified.id),true);
  assert.equal(googleOnlyDeletionAccount(store.db,passwordId),false);
  assert.equal(recentlyVerifiedGoogleDeletion(store.db,verified.id,verified.token,now),true);
  assert.equal(recentlyVerifiedGoogleDeletion(store.db,verified.id,other.token,now),false);
  assert.equal(recentlyVerifiedGoogleDeletion(store.db,passwordId,verified.token,now),false);
  // An old but still active customer session is not a fresh OAuth proof.
  store.db.prepare("UPDATE customer_sessions SET expires=expires-600000 WHERE account_id=?").run(verified.id);
  assert.equal(recentlyVerifiedGoogleDeletion(store.db,verified.id,verified.token,now),false);
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
});
test("Google deletion UI requires explicit reauthentication and confirmation",()=>{
 const ui=readFileSync(new URL("../app/(site)/account/settings/page.tsx",import.meta.url),"utf8");
 const route=readFileSync(new URL("../app/(site)/api/customer-account-erasure/route.ts",import.meta.url),"utf8");
 assert.match(ui,/Mit Google erneut anmelden/);
 assert.match(ui,/googleReauthenticated/);
 assert.match(route,/GOOGLE_REAUTH_REQUIRED/);
 assert.match(route,/recentlyVerifiedGoogleDeletion/);
 assert.match(route,/beginCustomerErasure\(store,id\)/);
});
