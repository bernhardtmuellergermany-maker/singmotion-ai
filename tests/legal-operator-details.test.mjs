import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const policies=readFileSync(new URL("../components/legal-policies.tsx",import.meta.url),"utf8");
const overview=readFileSync(new URL("../components/legal-overview.tsx",import.meta.url),"utf8");
test("canonical German imprint identifies the supplied operator and contact",()=>{
 for(const v of ["SingMotion AI","Bernhardt Müller","Erich-Kästner-Str. 37",
  "16312 Bernau bei Berlin","Germany","support@singmotion.ai"])assert.ok(policies.includes(v),v);
 for(const v of ["Operator: NOT VERIFIED","Address for service: NOT VERIFIED",
  "Direct electronic contact: NOT VERIFIED","Those details are currently NOT VERIFIED"])
  assert.ok(!policies.includes(v),v);
 assert.match(policies,/remainingOperatorReview/);
 assert.match(policies,/withdrawal declaration to Bernhardt Müller/);
 assert.match(policies,/Controller and privacy contact/);
});
test("legacy overview has real operator address not fictional samples",()=>{
 for(const v of ["Bernhardt Müller","Erich-Kästner-Str. 37",
 "16312 Bernau bei Berlin","support@singmotion.ai"])assert.ok(overview.includes(v),v);
 for(const v of ["[Example Street 1]","[Full name / Company name]",
  "[privacy contact email]","[abuse/contact email]"])assert.ok(!overview.includes(v),v);
});
