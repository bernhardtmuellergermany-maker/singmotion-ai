import test from "node:test";
import assert from "node:assert/strict";
import {contactTurnstileAccepted,CONTACT_TURNSTILE_ACTION} from "../lib/contact-turnstile.ts";
const hosts=["www.singmotion.ai","singmotion-ai-production.up.railway.app"];
const valid={success:true,hostname:"www.singmotion.ai",action:CONTACT_TURNSTILE_ACTION};
test("contact form accepts only its own verified Turnstile action and exact host",()=>{
 assert.equal(contactTurnstileAccepted(valid,hosts),true);
 for(const response of [
  {...valid,action:"login"},
  {...valid,action:undefined},
  {...valid,action:"singmotion_contact_other"},
  {...valid,success:false},
  {...valid,success:undefined},
  {...valid,hostname:"evil.www.singmotion.ai"},
  {...valid,hostname:"www.singmotion.ai.evil.example"},
  {...valid,hostname:""},
  {...valid,hostname:undefined},
  {},
  null,
 ])assert.equal(contactTurnstileAccepted(response,hosts),false);
 assert.equal(contactTurnstileAccepted(valid,[]),false);
});
