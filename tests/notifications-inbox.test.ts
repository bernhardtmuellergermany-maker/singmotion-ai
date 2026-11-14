import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {NotificationInbox} from "../lib/commerce/notifications.ts";

test("wallet events are visible only to their owner; read, unread and delete persist",()=>{
 const db=new DatabaseSync(":memory:");
 try {
  new CreditWallet(db);
  const inbox=new NotificationInbox(db);
  db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
   .run("credit-topup:a","customer:a",500,"purchase","credit-topup:a",Date.now());
  db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
   .run("credit-reversal:a","customer:a",-500,"refund","credit-reversal:a",Date.now()+1);
  db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
   .run("credit-topup:b","customer:b",800,"purchase","credit-topup:b",Date.now());
  assert.equal(inbox.list("customer:a").notifications.length,2);
  assert.equal(inbox.list("customer:b").notifications.length,1);
  assert.equal(inbox.list("customer:a").unread,2);
  inbox.mutate("customer:a","read","wallet:credit-topup:a");
  assert.equal(new NotificationInbox(db).list("customer:a").unread,1);
  inbox.mutate("customer:a","unread","wallet:credit-topup:a");
  assert.equal(inbox.list("customer:a").unread,2);
  inbox.mutate("customer:a","delete","wallet:credit-reversal:a");
  assert.equal(inbox.list("customer:a").notifications.length,1);
  assert.equal(inbox.list("customer:b").unread,1);
  assert.equal((db.prepare("SELECT count(*) AS n FROM credit_wallet_ledger").get() as {n:number}).n,3);
  inbox.mutate("customer:a","read-all");
  assert.equal(inbox.list("customer:a").unread,0);
  inbox.mutate("customer:a","clear-all");
  assert.equal(inbox.list("customer:a").notifications.length,0);
  assert.equal(inbox.list("customer:b").notifications.length,1);
  assert.throws(()=>inbox.mutate("customer:a","delete","wallet:credit-topup:b"),/Unknown notification/);
 }finally{db.close()}
});
test("broadcast notices are independent per user and can be dismissed privately",()=>{
 const db=new DatabaseSync(":memory:");
 try {
  new CreditWallet(db);
  const inbox=new NotificationInbox(db);
  db.prepare("INSERT INTO notification_announcements VALUES(?,?,?,?,?,?,?)")
   .run("release","Studio update","New features","all","update",Date.now()-1000,null);
  assert.equal(inbox.list("customer:a").unread,1);
  assert.equal(inbox.list("super-admin:admin").unread,1);
  inbox.mutate("customer:a","delete","announcement:release");
  assert.equal(inbox.list("customer:a").unread,0);
  assert.equal(inbox.list("customer:b").unread,1);
 }finally{db.close()}
});
test("notification API is authenticated and write operations are origin guarded",()=>{
 const root=new URL("../",import.meta.url);
 const api=readFileSync(new URL("app/(site)/api/notifications/route.ts",root),"utf8");
 const menu=readFileSync(new URL("components/header-account-menu.tsx",root),"utf8");
 assert.match(api,/resolveCreditWalletIdentity/);
 assert.match(api,/stagingDenial/);
 assert.match(api,/applicationOrigin/);
 assert.match(api,/read-all/);
 assert.match(api,/clear-all/);
 assert.match(menu,/href="\/notifications"/);
 assert.match(menu,/unreadNotices/);
});
