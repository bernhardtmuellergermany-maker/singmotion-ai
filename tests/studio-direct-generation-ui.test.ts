import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const wizard=readFileSync(new URL("../components/studio-wizard.tsx",import.meta.url),"utf8");

test("Step 4 starts authorized account Credit generation directly or guides guests to login",()=>{
 assert.match(wizard,/onClick=\{\(\)=>!creditStudio\?void openGuestAccount\(\):reviewShortage\?void continueToCreditPurchase\(\):void startCreditGeneration\(\)\}/);
 assert.match(wizard,/async function startCreditGeneration\(\)/);
 assert.match(wizard,/api<\{version:string\}>\("rights"\)/);
 assert.match(wizard,/access\.superAdmin/);
 assert.match(wizard,/access\.customerBeta/);
 assert.match(wizard,/!reviewRights/);
 assert.match(wizard,/wallet\.availableCredits<creditQuote\.credits/);
 assert.match(wizard,/action:"prepare",requestKey:projectKey,selection/);
 assert.match(wizard,/action:"submit",id:prepared\.id,digest:prepared\.digest/);
 assert.match(wizard,/window\.location\.assign\("\/videos\/live_"/);
});

test("generation is idempotently guarded and failures keep project recovery visible",()=>{
 assert.match(wizard,/if\(busy\|\|generating\|\|!selection/);
 assert.match(wizard,/generationProjectId\)return/);
 assert.match(wizard,/if\(prepared\.state!=="prepared"\)/);
 assert.match(wizard,/setGenerationProjectId\(prepared\.id\)/);
 assert.match(wizard,/Open the saved video status/);
 assert.match(wizard,/Checking your saved project and reserving Credits securely/);
});
