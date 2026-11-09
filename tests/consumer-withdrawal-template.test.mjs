import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const form=readFileSync(new URL("../components/withdrawal-template.tsx",import.meta.url),"utf8");
const page=readFileSync(new URL("../components/legal-policies.tsx",import.meta.url),"utf8");
test("withdrawal page exposes statutory model template and true operator contact",()=>{
 for(const value of ["Muster-Widerrufsformular","Bernhardt Müller",
  "Erich-Kästner-Str. 37","16312 Bernau bei Berlin","support@singmotion.ai",
  "Bestellt am","Anschrift des/der Verbraucher","Unterschrift","Anlage 2 EGBGB"])
  assert.ok(form.includes(value),value);
 assert.match(page,/slug==="withdrawal" \? <WithdrawalTemplate\/>/);
});
test("email preparation is not silently treated as submitted statutory withdrawal",()=>{
 assert.match(form,/mailto:/);
 assert.match(form,/selbst absenden/);
 assert.match(form,/kein Versand/);
 assert.match(form,/Online-Widerrufsfunktion/);
 assert.doesNotMatch(form,/<form|<button|fetch\(/);
});
