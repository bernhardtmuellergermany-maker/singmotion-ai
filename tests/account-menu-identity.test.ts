import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const menu=readFileSync(new URL("../components/header-account-menu.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../components/header-account-menu.css",import.meta.url),"utf8");

test("account menu shows verified customer or staff email above available credits",()=>{
 assert.match(menu,/readCustomerAuthStatus\(\)/);
 assert.match(menu,/const authenticated=v\?\.authenticated===true/);
 assert.match(menu,/setEmail\(authenticated\?verifiedEmail:null\)/);
 assert.match(menu,/email&&\(identity==="customer"\|\|identity==="super-admin"\|\|identity==="staff"\)/);
 const identity=menu.indexOf('className="sm-account-signed-in"');
 const balance=menu.indexOf("sm-account-credit-status");
 assert.ok(identity>=0&&balance>identity,"signed-in email must precede the credits panel");
 assert.match(menu,/<strong title=\{email\}>\{email\}<\/strong>/);
});

test("signed-in email remains discreet and can wrap in narrow mobile menus",()=>{
 assert.match(css,/\.sm-account-signed-in>span\{/);
 assert.match(css,/\.sm-account-signed-in>strong\{/);
 assert.match(css,/overflow-wrap:anywhere/);
 assert.match(menu,/window\.addEventListener\("sm-auth-changed",refresh\)/);
});
