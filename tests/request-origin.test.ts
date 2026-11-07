import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationOrigin } from "../lib/request-origin.ts";
import { privateGateMutationOriginAllowed } from "../lib/staging.ts";
const deployed = {
  NODE_ENV: "production",
  STAGING_AUTH_ENABLED: "true",
  CMS_ENABLED: "true",
  CMS_ORIGIN: "https://stage.example.test",
};
test("Studio uses explicit public CMS origin behind HTTPS-to-HTTP proxy", () => {
  assert.equal(
    applicationOrigin(
      "http://0.0.0.0:3000/api/session",
      "stage.example.test",
      deployed,
    ),
    "https://stage.example.test",
  );
  assert.equal(
    applicationOrigin("http://0.0.0.0:3000/api/session", "evil.test", deployed),
    "https://stage.example.test",
  );
  assert.equal(
    applicationOrigin("http://internal/api/session", "evil.test", {
      ...deployed,
      APP_ORIGIN: "https://app.example.test",
    }),
    "https://app.example.test",
  );
});
test("staging fails closed without valid configured origin", () => {
  for (const value of [
    "https://stage.example.test/",
    "https://user:pass@stage.example.test",
    "http://stage.example.test",
    "not-a-url",
  ])
    assert.equal(
      applicationOrigin("http://internal/api/session", "evil.test", {
        ...deployed,
        APP_ORIGIN: value,
      }),
      null,
    );
  assert.equal(
    applicationOrigin("http://internal/api/session", "evil.test", {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_ID: "test",
    }),
    null,
  );
  assert.equal(
    applicationOrigin("http://internal/api/session", "evil.test", {
      ...deployed,
      CMS_ENABLED: "false",
    }),
    null,
  );
});
test("direct development and explicitly configured loopback remain supported", () => {
  assert.equal(
    applicationOrigin("http://localhost:3000/api/session", "localhost:3000", {
      STAGING_AUTH_ENABLED: "false",
    }),
    "http://localhost:3000",
  );
  assert.equal(
    applicationOrigin("http://internal/api/session", "internal", {
      APP_ORIGIN: "http://127.0.0.1:3197",
    }),
    "http://127.0.0.1:3197",
  );
});

test("Railway Studio rejects a stale APP_ORIGIN and accepts only its corrected HTTPS origin", () => {
  const origin = "https://singmotion-ai-staging.up.railway.app";
  const internal = "http://0.0.0.0:3000/api/session";
  const configured = {
    ...deployed,
    CMS_ORIGIN: origin,
    APP_ORIGIN: "http://localhost:3000",
  };
  // This produces the reported 403 even when CMS_ORIGIN is correct.
  assert.notEqual(
    applicationOrigin(internal, "internal.railway", configured),
    origin,
  );
  for (const env of [
    { ...configured, APP_ORIGIN: origin },
    { ...configured, APP_ORIGIN: "" },
  ]) {
    const expected = applicationOrigin(internal, "attacker.example", env);
    assert.equal(expected, origin);
    for (const untrusted of [
      null,
      "null",
      "https://attacker.example",
      origin + ".attacker.example",
    ])
      assert.notEqual(untrusted, expected);
  }
});


test("private cookie mutation Origin rejects untrusted Host fallback in both Railway environments",()=>{
 for(const id of ["dfaeabed-03df-43ed-aa71-50f343a75041",
  "36adc41d-7e54-4396-ad1a-fd432ba0441d"]){
  const base={RAILWAY_ENVIRONMENT_ID:id,STAGING_AUTH_ENABLED:"true"};
  const path="/api/customer-auth";
  const untrusted="https://attacker.invalid";
  assert.equal(privateGateMutationOriginAllowed(untrusted,path,untrusted,base),false);
  assert.equal(privateGateMutationOriginAllowed("http://internal:8080",path,"http://internal:8080",base),false);
  for(const configured of ["http://www.singmotion.ai",
   "https://user:secret@www.singmotion.ai",
   "https://www.singmotion.ai/customer-auth",
   "https://www.singmotion.ai/",
   "not-a-url"]){
   assert.equal(privateGateMutationOriginAllowed(configured,path,configured,
    {...base,APP_ORIGIN:configured}),false,configured);
  }
  assert.equal(privateGateMutationOriginAllowed("https://www.singmotion.ai",path,
   "http://internal:8080",{...base,APP_ORIGIN:"https://www.singmotion.ai"}),true);
  assert.equal(privateGateMutationOriginAllowed("https://evil.invalid",path,
   "http://internal:8080",{...base,APP_ORIGIN:"https://www.singmotion.ai"}),false);
  assert.equal(privateGateMutationOriginAllowed("https://www.singmotion.ai","/api/cms/pages",
   "https://www.singmotion.ai",{...base,APP_ORIGIN:"https://www.singmotion.ai",
    CMS_ORIGIN:"https://cms.singmotion.ai"}),false);
  assert.equal(privateGateMutationOriginAllowed("https://cms.singmotion.ai","/api/cms/pages",
   "http://internal:8080",{...base,APP_ORIGIN:"https://www.singmotion.ai",
    CMS_ORIGIN:"https://cms.singmotion.ai"}),true);
 }
});

test("unprotected loopback development can still use local request origin",()=>{
 assert.equal(privateGateMutationOriginAllowed("http://localhost:3000","/api/session",
  "http://localhost:3000",{STAGING_AUTH_ENABLED:"false"}),true);
 assert.equal(privateGateMutationOriginAllowed("http://evil.invalid","/api/session",
  "http://localhost:3000",{STAGING_AUTH_ENABLED:"false"}),false);
 assert.equal(privateGateMutationOriginAllowed("http://localhost:3000","/api/session",
  "http://localhost:3000",{STAGING_AUTH_ENABLED:"true"}),false);
});
