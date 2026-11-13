import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("feedback preview is explicitly restricted to private Railway staging",()=>{
  const route=read("app/(site)/studio/feedback-preview/page.tsx");
  assert.match(route,/RAILWAY_ENVIRONMENT_ID\s*!==\s*"dfaeabed-03df-43ed-aa71-50f343a75041"/);
  assert.match(route,/notFound\(\)/);
  assert.match(route,/index:false,follow:false/);
});

test("preview does not call any payment, upload, provider or account API",()=>{
  const preview=read("components/feedback-preview.tsx");
  assert.doesNotMatch(preview,/\bfetch\s*\(|\bapi\s*\(|\/api\/|\.submit\s*\(/);
  assert.match(preview,/onClickCapture/);
  assert.match(preview,/event\.preventDefault\(\)/);
  assert.match(preview,/CustomerFeedback/);
  assert.match(preview,/0 orders · 0 Stripe payments · 0 BytePlus requests · 0 Credit changes/);
});

test("all actionable customer states can be simulated without real orders",()=>{
  const preview=read("components/feedback-preview.tsx");
  for(const code of ["provider-refund","provider-review","credits-low","queued","processing","delayed",
    "uncertain","failed","ready","payment-cancelled","payment-return","payment-declined","payment-offline",
    "upload-offline","upload-invalid","maintenance","session","rate-limit"]){
    assert.match(preview,new RegExp(`id:"${code}"`));
  }
  assert.match(preview,/generationFeedback/);
  assert.match(preview,/providerFeedback/);
  assert.match(preview,/checkoutFeedback/);
  assert.match(preview,/requestErrorFeedback/);
});
