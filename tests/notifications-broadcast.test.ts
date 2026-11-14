import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {NotificationInbox} from "../lib/commerce/notifications.ts";
const root=new URL("../",import.meta.url);
test("Super Admin broadcast requires signed-in privileged identity, origin and body validation",()=>{
 const api=readFileSync(new URL("app/(site)/api/admin-announcements/route.ts",root),"utf8");
 const settings=readFileSync(new URL("app/(site)/account/settings/page.tsx",root),"utf8");
 assert.match(api,/resolveCreditWalletIdentity/);
 assert.match(api,/identity\.subject\.startsWith\("super-admin:"\)/);
 assert.match(api,/stagingDenial/);
 assert.match(api,/req\.headers\.get\("origin"\)!==origin/);
 assert.match(api,/INSERT OR IGNORE INTO notification_announcements/);
 assert.match(api,/audience,category,published_at,expires_at/);
 assert.match(api,/VALUES\(\?,\?,\?,'all',\?,\?,NULL\)/);
 assert.match(settings,/canShowAdmin&&<AdminAnnouncements\/>/);
 assert.match(settings,/href="#announcements"/);
});
test("Broadcast is shown to each account; individual deletion does not remove announcements elsewhere",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  new CreditWallet(db);
  const inbox=new NotificationInbox(db);
  db.prepare("INSERT INTO notification_announcements VALUES(?,?,?,?,?,?,?)")
   .run("notice-global","New features","Studio now supports additional features.","all","update",Date.now()-10,null);
  assert.equal(inbox.list("customer:first").notifications[0]?.id,"announcement:notice-global");
  assert.equal(inbox.list("customer:second").notifications[0]?.id,"announcement:notice-global");
  assert.equal(inbox.list("super-admin:owner").notifications[0]?.id,"announcement:notice-global");
  inbox.mutate("customer:first","delete","announcement:notice-global");
  assert.equal(inbox.list("customer:first").notifications.length,0);
  assert.equal(inbox.list("customer:second").notifications.length,1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM notification_announcements").get() as {count:number}).count,1);
 }finally{db.close()}
});
test("Notification presentation has no extraneous links and swaps the envelope action by state",()=>{
 const ui=readFileSync(new URL("components/notification-center.tsx",root),"utf8");
 assert.doesNotMatch(ui,/View details/);
 assert.doesNotMatch(ui,/Back to credits/);
 assert.match(ui,/>\{item\.read\?<MailOpen size=\{17\}\/>:<Mail size=\{17\}\/>\}<\/button>/);
});
