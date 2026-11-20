import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {ManualCreditGifts} from "../lib/commerce/manual-credit-gifts.ts";
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

test("Notifications shares the site-wide transparent header and background with its own canvas",()=>{
 const root=new URL("../",import.meta.url);
 const page=readFileSync(new URL("app/(site)/notifications/page.tsx",root),"utf8");
 const styles=readFileSync(new URL("components/notifications.css",root),"utf8");
 const navigation=readFileSync(new URL("app/(site)/site-navigation.css",root),"utf8");
 assert.match(page,/className="sm-carousel-page sm-notifications-layout"/);
 assert.match(page,/<SiteHeader\/>/);
 assert.match(styles,/\.sm-carousel-page\.sm-notifications-layout\{background:#0b0b16\}/);
 assert.match(styles,/\.sm-notifications-page\{[^}]*background:#0b0b16/);
 assert.match(navigation,/\.sm-site-header\s*\{[^}]*background:transparent!important/);
 assert.doesNotMatch(styles,/\.sm-site-header\s*\{/);
});

test("gift credit ledger events create private unread notifications and reading clears the gift hint",()=>{
 const env={CMS_ENABLED:"true",RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",ADMIN_MANUAL_CREDITS_ENABLED:"true"};
 const store=new CommerceStore(":memory:",env);
 try{
  const customerId=store.register("gift-notice@example.test","securepassword123");
  const otherId=store.register("other-notice@example.test","securepassword456");
  const grants=new ManualCreditGifts(store.db,env);
  const request={customerId,credits:500,reason:"welcome" as const,actor:"owner",requestKey:randomUUID()};
  const gift=grants.grant(request);
  assert.equal(grants.grant(request).replayed,true);
  const inbox=new NotificationInbox(store.db);
  const subject="customer:"+customerId;
  const received=inbox.list(subject);
  assert.equal(received.unread,1);
  assert.equal(received.notifications.length,1,"idempotent grant produces one notice");
  assert.equal(received.notifications[0].kind,"gift");
  assert.match(received.notifications[0].title,/Gift Credits received/);
  assert.match(received.notifications[0].message,/500 gift Credits/);
  assert.equal(received.notifications[0].href,"/credits#usage");
  assert.equal(inbox.list("customer:"+otherId).unread,0,"other account sees no gift");
  inbox.mutate(subject,"read",received.notifications[0].id);
  assert.equal(new NotificationInbox(store.db).list(subject).unread,0);
  grants.correct({giftId:gift.gift.id,actor:"owner",reason:"Correction requested after documented duplicate grant",requestKey:randomUUID()});
  const corrected=inbox.list(subject);
  assert.equal(corrected.unread,1,"correction has its own notice");
  assert.equal(corrected.notifications.filter(n=>n.kind==="gift").length,1);
  assert.match(corrected.notifications.find(n=>n.title==="Gift Credits adjusted")?.message??"",/500 gift Credits removed/);
 }finally{store.close()}
});
test("small round purple account badge shows all unread notifications and caps display at 9+",()=>{
 const root=new URL("../",import.meta.url);
 const header=readFileSync(new URL("components/header-account-menu.tsx",root),"utf8");
 const css=readFileSync(new URL("components/header-account-menu.css",root),"utf8");
 const center=readFileSync(new URL("components/notification-center.tsx",root),"utf8");
 assert.doesNotMatch(header,/unreadGifts|setUnreadGifts/);
 assert.match(header,/unreadNotices>0&&<span className="sm-account-gift-badge"/);
 assert.match(header,/unreadNotices>9\?"9\+":unreadNotices/);
 assert.match(header,/\$\{unreadNotices\} unread notifications/);
 assert.match(header,/setUnreadNotices\(typeof data\.unread/);
 assert.match(css,/\.sm-account-menu \.sm-account-gift-badge/);
 assert.match(css,/top:15%;right:15%;transform:translate\(50%,-50%\)/);
 assert.match(css,/background:#8547bd/);
 assert.match(css,/width:19px;min-width:19px;max-width:19px;height:19px;padding:0/);
 assert.match(css,/border-radius:50%/);
 assert.match(center,/className="sm-notice-gift-open"/);
 assert.match(center,/onClick=\{\(\)=>void apply\("read",item\.id\)\}/);
 assert.match(center,/notifications-changed/);
});
