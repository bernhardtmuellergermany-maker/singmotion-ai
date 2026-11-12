import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const form=readFileSync(new URL("../components/withdrawal-template.tsx",import.meta.url),"utf8");
const page=readFileSync(new URL("../components/legal-policies.tsx",import.meta.url),"utf8");
test("withdrawal page exposes statutory model template and true operator contact",()=>{
 for(const value of ["Model withdrawal form","Bernhardt Müller",
  "Erich-Kästner-Str. 37","16312 Bernau bei Berlin","support@singmotion.ai",
  "Ordered on","Postal address of consumer","Signature","Annex 2 to the EGBGB"])
  assert.ok(form.includes(value),value);
 assert.match(page,/slug==="withdrawal" \? <><OnlineWithdrawal\/><WithdrawalTemplate\/><\/>/);
});
test("email preparation is not silently treated as submitted statutory withdrawal",()=>{
 assert.match(form,/mailto:/);
 assert.match(form,/send the email yourself/);
 assert.match(form,/does not submit a withdrawal to our servers/);
 assert.match(form,/online withdrawal declaration function/);
 assert.doesNotMatch(form,/<form|<button|fetch\(/);
});
