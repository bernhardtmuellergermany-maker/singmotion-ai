import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("feedback and Output preview are explicitly restricted to private Railway staging",()=>{
  for(const page of ["feedback-preview","output-preview"]){
    const route=read(`app/(site)/studio/${page}/page.tsx`);
    assert.match(route,/RAILWAY_ENVIRONMENT_ID\s*!==\s*"dfaeabed-03df-43ed-aa71-50f343a75041"/);
    assert.match(route,/notFound\(\)/);
    assert.match(route,/index:false,follow:false/);
  }
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
    "uncertain","failed","ready","provider-job-failed","output-validation","payment-refunded","payment-disputed","paid-output-failed","payment-cancelled","payment-return","payment-declined","payment-offline",
    "upload-offline","upload-invalid","maintenance","session","rate-limit"]){
    assert.match(preview,new RegExp(`id:"${code}"`));
  }
  assert.match(preview,/generationFeedback/);
  assert.match(preview,/providerFeedback/);
  assert.match(preview,/checkoutFeedback/);
  assert.match(preview,/requestErrorFeedback/);
});

test("Output page preview renders the very same component as the customer output view",()=>{
  const preview=read("components/feedback-preview.tsx");
  const realOutput=read("components/customer-paid-output.tsx");
  const realComponent=read("components/generation-status-view.tsx");
  assert.match(preview,/import \{GenerationStatusView,type GenerationProgress\}/);
  assert.match(preview,/<GenerationStatusView key=\{active\.id/);
  assert.match(preview,/previewNotice=\{active\.notice\}/);
  assert.match(realOutput,/GenerationStatusView/);
  assert.match(realComponent,/previewNotice\?\?\(/);
  assert.match(preview,/Full Output page/);
  assert.match(preview,/Desktop/);
  assert.match(preview,/Mobile/);
  assert.match(preview,/EXAMPLE OUTPUT · NO ACTUAL ORDER/);
  assert.match(preview,/videoUrl:"\/media\/demo\.mp4"/);
});

test("Output sample never starts a job, payment or checkout, and disables example links",()=>{
  const preview=read("components/feedback-preview.tsx");
  assert.doesNotMatch(preview,/\bfetch\s*\(|\bapi\s*\(|\/api\/|\.submit\s*\(/);
  assert.match(preview,/onClickCapture/);
  assert.match(preview,/closest\("a"\)/);
  assert.match(preview,/event\.preventDefault\(\)/);
  assert.doesNotMatch(preview,/window\.location|checkout\.stripe\.com/);
});
