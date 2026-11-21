import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {quoteVideoCredits} from "../lib/commerce/video-credit-quote.ts";

const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
test("audio card shows selected clip Credit cost from the same active tariff as Step 4",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const css=read("app/(site)/studio-refinement.css");
 assert.match(wizard,/const clipCreditQuote=draft\.song&&activeTariff/);
 assert.match(wizard,/quoteVideoCredits\(draft\.start,draft\.end,activeTariff\.creditsPerSecond\)/);
 assert.match(wizard,/step!==0&&step!==3/);
 assert.match(wizard,/Selection: \$\{formatCredits\(clipCreditQuote\.credits\)\} Credits/);
 assert.doesNotMatch(wizard,/Selected clip \{sourceTimestamp/);
 assert.match(css,/sm-new-file-credits-cost/);
 assert.match(css,/sm-new-file-credits-balance/);
 const price=quoteVideoCredits(34.455,47.052,25);
 assert.equal(price?.startedSeconds,13);
 assert.equal(price?.credits,325);
});
test("signed-in balance comes from private wallet and correctly distinguishes shortage from remaining",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const balance=read("app/(site)/api/credit-balance/route.ts");
 assert.match(wizard,/creditStudio&&clipCreditQuote&&reviewBalance!==null/);
 assert.match(wizard,/fetch\("\/api\/credit-balance",\{cache:"no-store",credentials:"same-origin"\}\)/);
 assert.match(wizard,/reviewBalance-clipCreditQuote\.credits/);
 assert.match(wizard,/clipCreditQuote\.credits-reviewBalance/);
 assert.match(wizard,/reviewBalance<clipCreditQuote\.credits/);
 assert.match(balance,/availableCredits:Math\.max\(0,rawBalance\)/);
 assert.match(wizard,/window\.addEventListener\("credits-changed",refresh\)/);
});

test("audio quick tips use the same private upload and existing waveform",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const tips=read("components/audio-quick-tips.tsx");
 const api=read("app/(site)/api/audio-quick-tips/route.ts");
 const ops=read("components/cms/operations.tsx");
 assert.ok(wizard.indexOf("<AudioQuickTips")>wizard.indexOf("<SunoSongImport"));
 assert.match(wizard,/add\(undefined,"audio",\(\)=>downloadAudioQuickTip\(tip\)\)/);
 assert.match(wizard,/uploadWithProgress\(file, kind,/);
 assert.match(wizard,/<Waveform key=\{draft.song.id\}/);
 assert.match(tips,/new File\(\[blob\],tip.filename/);
 assert.match(api,/await mutationAllowed\(req\)/);
 assert.match(api,/await validateAudio\(source\)/);
 assert.match(api,/AND active=1/);
 assert.match(ops,/href:"\/admin\/audio-quick-tips"/);
});
