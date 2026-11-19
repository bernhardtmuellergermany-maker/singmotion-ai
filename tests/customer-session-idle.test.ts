import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CommerceStore,DEFAULT_CUSTOMER_IDLE_MINUTES,CUSTOMER_IDLE_MINUTES} from "../lib/commerce/store.ts";

function temporaryStore(fn:(store:CommerceStore)=>void){
 const dir=mkdtempSync(path.join(tmpdir(),"sm-session-policy-"));
 const store=new CommerceStore(path.join(dir,"commerce.sqlite"),{CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
 try{fn(store);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
}
const MINUTE=60_000;
const password="strong-customer-test-password";

test("new accounts default to 30 minutes, no GET polling can refresh activity, and timeout revokes every device",()=>{
 temporaryStore(store=>{
  const account=store.register("one@example.test",password);
  const other=store.register("two@example.test",password);
  const first=store.login("one@example.test",password);
  const second=store.login("one@example.test",password);
  const otherToken=store.login("two@example.test",password);
  const policy=store.sessionPolicy(account);
  assert.equal(policy.idleMinutes,DEFAULT_CUSTOMER_IDLE_MINUTES);
  assert.equal(DEFAULT_CUSTOMER_IDLE_MINUTES,30);
  assert.equal(store.session(first,policy.lastActivity+10*MINUTE),account);
  assert.equal(store.session(second,policy.lastActivity+29*MINUTE),account);
  // The expiry belongs to the account and invalidates every token on first check.
  assert.equal(store.session(first,policy.lastActivity+30*MINUTE),null);
  assert.equal(store.session(second,policy.lastActivity+30*MINUTE),null);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_sessions WHERE account_id=?").get(account)?.n,0);
  assert.equal(store.session(otherToken),other);
 });
});

test("real user activity on one device extends the account-wide deadline; background reads do not",()=>{
 temporaryStore(store=>{
  const account=store.register("one@example.test",password);
  const first=store.login("one@example.test",password);
  const second=store.login("one@example.test",password);
  const start=store.sessionPolicy(account).lastActivity;
  const updated=store.touchSession(first,start+20*MINUTE);
  assert.equal(updated?.lastActivity,start+20*MINUTE);
  assert.equal(store.session(second,start+45*MINUTE),account);
  assert.equal(store.session(first,start+49*MINUTE),account);
  assert.equal(store.session(second,start+50*MINUTE),null);
  assert.equal(store.session(first),null);
 });
});

test("custom interval, Off, unsupported values, and unchanged absolute 24-hour expiry",()=>{
 temporaryStore(store=>{
  const account=store.register("choice@example.test",password);
  const token=store.login("choice@example.test",password);
  const start=store.sessionPolicy(account).lastActivity;
  assert.deepEqual([...CUSTOMER_IDLE_MINUTES],[0,5,15,30,60,120,240,480]);
  assert.throws(()=>store.setSessionIdleMinutes(account,7),/Unsupported inactivity interval/);
  assert.throws(()=>store.setSessionIdleMinutes(account,-1),/Unsupported inactivity interval/);
  assert.equal(store.setSessionIdleMinutes(account,5,start).idleMinutes,5);
  assert.equal(store.session(token,start+4*MINUTE),account);
  assert.equal(store.session(token,start+5*MINUTE),null);
  const newToken=store.login("choice@example.test",password);
  const secondStart=store.sessionPolicy(account).lastActivity;
  assert.equal(store.setSessionIdleMinutes(account,0,secondStart).idleMinutes,0);
  assert.equal(store.session(newToken,secondStart+23*60*MINUTE),account);
  assert.equal(store.session(newToken,secondStart+25*60*MINUTE),null);
 });
});

test("password logout-all still invalidates sessions and older customer rows bootstrap safely",()=>{
 temporaryStore(store=>{
  const account=store.register("legacy@example.test",password);
  const token=store.login("legacy@example.test",password);
  store.db.prepare("DELETE FROM customer_session_policies WHERE account_id=?").run(account);
  assert.equal(store.session(token),account);
  assert.equal(store.sessionPolicy(account).idleMinutes,30);
  const second=store.login("legacy@example.test",password);
  store.logoutAll(account);
  assert.equal(store.session(token),null);
  assert.equal(store.touchSession(second),null);
 });
});

test("the browser only reports trusted user gestures; settings enforce origin and authenticated sessions",()=>{
 const guard=readFileSync(new URL("../components/customer-idle-guard.tsx",import.meta.url),"utf8");
 const route=readFileSync(new URL("../app/(site)/api/customer-session-activity/route.ts",import.meta.url),"utf8");
 const api=readFileSync(new URL("../app/(site)/api/[...path]/route.ts",import.meta.url),"utf8");
 assert.match(guard,/event\.isTrusted/);
 assert.match(guard,/method:"POST"/);
 assert.match(guard,/setInterval\(\(\)=>void check\(\),30000\)/);
 assert.match(route,/req\.headers\.get\("origin"\)!==origin/);
 assert.match(route,/store\.session\(token\)/);
 assert.match(route,/CUSTOMER_IDLE_MINUTES\.includes/);
 assert.match(api,/commerce\.session\(req\.cookies\.get\("sm_customer"\)\?\.value\|\|""\)/);
});

test("expired customer session cleans HttpOnly identities before showing sign-in, including a first-load expired cookie",()=>{
 const guard=readFileSync(new URL("../components/customer-idle-guard.tsx",import.meta.url),"utf8");
 const activity=readFileSync(new URL("../app/(site)/api/customer-session-activity/route.ts",import.meta.url),"utf8");
 const login=readFileSync(new URL("../components/account-panel.tsx",import.meta.url),"utf8");
 const auth=readFileSync(new URL("../lib/client-auth-status.ts",import.meta.url),"utf8");
 assert.match(activity,/expiredSession:Boolean\(token\)/);
 assert.match(activity,/response\.cookies\.delete\("sm_customer"\)/);
 assert.match(activity,/response\.cookies\.delete\("sm_session"\)/);
 assert.match(activity,/response\.cookies\.delete\("payload-token"\)/);
 assert.match(activity,/if\(token\)\{/);
 assert.match(guard,/await fetch\("\/api\/unified-logout"/);
 assert.match(guard,/window\.location\.replace\("\/login\?session=expired"\)/);
 assert.match(guard,/state\?\.expiredSession===true/);
 assert.match(login,/window\.addEventListener\("sm-auth-changed",changed\)/);
 assert.match(login,/setAccount\(d\?\.authenticated===true\?d.email\?\?null:null\)/);
 assert.match(auth,/export function invalidateCustomerAuthStatus\(\)/);
});
