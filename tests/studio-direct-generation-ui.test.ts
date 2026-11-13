import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const wizard=readFileSync(new URL("../components/studio-wizard.tsx",import.meta.url),"utf8");

test("Step 4 starts authorized operator generation directly without opening a dialog",()=>{
 assert.match(wizard,/onClick=\{\(\)=>operatorStudio\?void startOperatorGeneration\(\):setConfirm\(true\)\}/);
 assert.match(wizard,/async function startOperatorGeneration\(\)/);
 assert.match(wizard,/api<\{version:string\}>\("rights"\)/);
 assert.match(wizard,/access\.superAdmin/);
 assert.match(wizard,/!reviewRights/);
 assert.match(wizard,/availableCredits<creditQuote\.credits/);
 assert.match(wizard,/action:"prepare",requestKey:projectKey,selection/);
 assert.match(wizard,/action:"submit",id:prepared\.id,digest:prepared\.digest/);
 assert.match(wizard,/window\.location\.assign\("\/projects\/live_"/);
});

test("generation is idempotently guarded and failures keep project recovery visible",()=>{
 assert.match(wizard,/if\(busy\|\|generating\|\|!selection/);
 assert.match(wizard,/generationProjectId\)return/);
 assert.match(wizard,/if\(prepared\.state!=="prepared"\)/);
 assert.match(wizard,/setGenerationProjectId\(prepared\.id\)/);
 assert.match(wizard,/Open the saved video status/);
 assert.match(wizard,/Checking your saved project and reserving Credits securely/);
});
