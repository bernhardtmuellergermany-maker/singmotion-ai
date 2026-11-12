import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");

test("signed-in account displays current credits and centered actionable links",()=>{
 const account=read("components/account-panel.tsx");
 const styles=read("components/account-credit-summary.css");
 assert.match(account,/<AccountCreditSummary active=\{active\} staff=\{staff\} superAdmin=\{superAdmin\}\/>/);
 assert.match(account,/href="\/credits" className="sm-account-action sm-account-action-buy"/);
 assert.match(account,/href="\/studio\?new=1" className="sm-account-action sm-account-action-create"/);
 assert.match(account,/className="sm-account-settings-link"/);
 assert.match(account,/className="sm-account-signout"/);
 assert.match(styles,/\.sm-account-signed-in \.sm-account-settings-link/);
 assert.match(styles,/\.sm-account-signed-in \.sm-account-signout/);
 assert.match(styles,/max-width:none;min-height:49px;margin:0/);
});

test("credit indicator is private and safely separates staff preview from customer balance",()=>{
 const credit=read("components/account-credit-summary.tsx");
 assert.match(credit,/fetch\("\/api\/credit-balance"/);
 assert.match(credit,/creditTone\(available\)/);
 assert.match(credit,/superAdmin\?testCredits/);
 assert.match(credit,/keine echten Credits/);
 assert.match(credit,/0,500,1500/);
 assert.match(credit,/Guthaben aktuell nicht verfügbar/);
});
