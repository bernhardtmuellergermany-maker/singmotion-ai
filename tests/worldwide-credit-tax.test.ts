import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {assessWorldwideCreditTax,worldwideTaxPolicyAvailable} from "../lib/commerce/worldwide-credit-tax.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";

const policy=(entries:unknown[])=>({
 CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED:"true",
 CREDIT_TAX_DE_KLEINUNTERNEHMER_APPROVED:"true",
 CREDIT_TAX_COUNTRY_POLICY_JSON:JSON.stringify({revision:"review-2026",reviewedAt:new Date().toISOString().slice(0,10),entries}),
});
const de={country:"DE",buyerType:"consumer",voucherKind:"single-purpose",
 mode:"de-small-business",evidence:"Human legal review of German domestic small business voucher taxes"};
const us={country:"US",buyerType:"consumer",voucherKind:"single-purpose",
 mode:"stripe-tax",evidence:"Independent state-by-state sales tax collection review for digital vouchers",
 taxRegistrationEvidence:"Signed tax nexus and registration assessment with Stripe Tax"};
test("global countries are never implicitly tax exempt",()=>{
 const e=policy([de,us]);
 assert.equal(worldwideTaxPolicyAvailable(e),true);
 assert.equal(assessWorldwideCreditTax(e,"DE","consumer").decision?.mode,"de-small-business");
 assert.equal(assessWorldwideCreditTax(e,"US","consumer").ready,false,
  "US requires independently reviewed Stripe product classification");
 assert.equal(assessWorldwideCreditTax(e,"GB","consumer").ready,false);
 assert.equal(assessWorldwideCreditTax(e,"DE","business").ready,false);
 assert.equal(assessWorldwideCreditTax(e,"ZZ","consumer").ready,false);
 assert.equal(assessWorldwideCreditTax(e,"de","consumer").ready,false);
 assert.equal(assessWorldwideCreditTax(e,"DE",null).ready,false);
});
test("Stripe Tax applies only to individually approved taxable issue-time country",()=>{
 const e={...policy([de,us]),STRIPE_CREDIT_TAX_CODE:"txcd_10000000",STRIPE_CREDIT_TAX_REVIEW_APPROVED:"true"};
 const usResult=assessWorldwideCreditTax(e,"US","consumer");
 assert.equal(usResult.ready,true);
 assert.equal(usResult.decision?.mode,"stripe-tax");
 assert.equal(usResult.decision?.taxCode,"txcd_10000000");
 assert.equal(assessWorldwideCreditTax(e,"DE","consumer").decision?.taxCode,null);
 assert.equal(assessWorldwideCreditTax({...e,STRIPE_CREDIT_TAX_REVIEW_APPROVED:"false"},"US","consumer").ready,false);
});
test("unverified voucher redemption taxation blocks sales in every jurisdiction",()=>{
 const e=policy([{...de,voucherKind:"multi-purpose"}]);
 assert.equal(assessWorldwideCreditTax(e,"DE","consumer").reason,"REDEMPTION_TIME_TAX_LEDGER_NOT_APPROVED");
});
test("unreviewed or stale jurisdiction policy fails closed",()=>{
 const e=policy([de]);
 for(const bad of ["", "false", "{}", "{broken"]){
  assert.equal(worldwideTaxPolicyAvailable({...e,CREDIT_TAX_COUNTRY_POLICY_JSON:bad}),false);
 }
 const old={...e,CREDIT_TAX_COUNTRY_POLICY_JSON:JSON.stringify({
  revision:"old-policy",reviewedAt:"2024-01-01",entries:[de]})};
 assert.equal(worldwideTaxPolicyAvailable(old),false);
 assert.equal(worldwideTaxPolicyAvailable(policy([de,de])),false);
 assert.equal(worldwideTaxPolicyAvailable(policy([{...de,country:"US"}])),false,
  "German §19 cannot be copied to the United States");
 assert.equal(worldwideTaxPolicyAvailable({...e,CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED:"false"}),false);
});
test("each paid credit request retains its immutable tax decision before checkout",()=>{
 const db=new DatabaseSync(":memory:");const wallet=new CreditWallet(db);
 const identity={subject:"customer:test123",customerId:"test123",email:"test@example.com"};
 const id="00000000-0000-4000-8000-000000000010";
 const purchase=wallet.pending(identity,500,id);
 const decision=assessWorldwideCreditTax(policy([de]),"DE","consumer").decision!;
 assert.ok(decision);
 wallet.bindTaxContext(purchase.id,decision);
 assert.deepEqual(wallet.taxContext(purchase.id),{country:"DE",buyerType:"consumer",
  voucherKind:"single-purpose",mode:"de-small-business",revision:"review-2026"});
 wallet.bindTaxContext(purchase.id,decision);
 assert.throws(()=>wallet.bindTaxContext(purchase.id,{...decision,country:"US"}),/conflict/);
 db.close();
});
