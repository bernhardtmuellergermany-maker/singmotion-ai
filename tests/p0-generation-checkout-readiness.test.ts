import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");

test("P0 disabled customer checkout cannot be presented as a mandatory Super Admin login",()=>{
 const dialog=source("../components/generation-dialog.tsx");
 assert.match(dialog,/Optionale Super-Admin-Anmeldung/);
 assert.match(dialog,/normale Gast- und Kundenbestellung ist hier derzeit nicht freigegeben/);
 assert.match(dialog,/checkoutUnavailableReason/);
 assert.doesNotMatch(dialog,/Customer generation is not available yet/);
 assert.match(dialog,/!customerCheckoutEnabled/);
});
test("P0 readiness is visible in safe form and paid backend remains independently gated",()=>{
 const api=source("../app/(site)/api/customer-orders/route.ts");
 const checkout=source("../app/(site)/api/stripe-checkout/route.ts");
 const worker=source("../scripts/worker.ts");
 assert.match(api,/checkoutUnavailableReason/);
 assert.match(api,/readiness\.readyForPaidOrders/);
 assert.match(checkout,/customerLaunchReadiness\(\)\.readyForPaidOrders/);
 assert.match(worker,/CUSTOMER_CHECKOUT_READINESS/);
 assert.match(worker,/paidReadiness\.blockers/);
 assert.doesNotMatch(worker,/JSON\.stringify\(process\.env\)/);
});
