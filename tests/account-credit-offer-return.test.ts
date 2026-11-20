import test from "node:test";
import assert from "node:assert/strict";
import {CREDIT_BUY_RETURN,parseAccountReturn,parseStudioAccountReturn,studioAccountReturn} from "../lib/studio-account-handoff.ts";

test("Credits return permits only the exact fixed Credits destination",()=>{
 assert.equal(CREDIT_BUY_RETURN,"/credits#buy-credits");
 assert.equal(parseAccountReturn(CREDIT_BUY_RETURN),CREDIT_BUY_RETURN);
 for(const raw of [null,"","/credits","/credits?next=evil","//evil.example",
  "https://evil.example/credits","/admin","/login","/studio?new=1",
  "/credits#other","/credits#buy-credits?next=https://evil.example"]){
  assert.equal(parseAccountReturn(raw),null,"Unexpected redirect for "+raw);
 }
});
test("existing validated Studio handoff remains supported",()=>{
 const next=studioAccountReturn("draft_123",48);
 assert.ok(next);
 assert.deepEqual(parseStudioAccountReturn(next),{draftId:"draft_123",requiredCredits:48});
 assert.equal(parseAccountReturn(next),next);
 assert.equal(parseAccountReturn("/studio/continue?draft=a&requiredCredits=5&evil=1"),null);
});
