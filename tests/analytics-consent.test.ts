import test from "node:test";
import assert from "node:assert/strict";
import { analyticsConfig, CONSENT_TTL, readConsent, serializeConsent, publicAnalyticsPage, publicAnalyticsLocation, sanitizedReferrer } from "../lib/analytics/consent.ts";
test("analytics defaults off and requires an explicit environment-specific valid GA4 id", () => {
  assert.deepEqual(analyticsConfig({}), {id:null,preview:false});
  assert.equal(analyticsConfig({GA4_ENABLED:"true",GA4_MEASUREMENT_ID:"G-TEST1234"}).id,null);
  assert.equal(analyticsConfig({RAILWAY_ENVIRONMENT_NAME:"production",GA4_MEASUREMENT_ID:"G-TEST1234"}).id,null);
  assert.equal(analyticsConfig({RAILWAY_ENVIRONMENT_NAME:"production",GA4_ENABLED:"true",GA4_MEASUREMENT_ID:"invalid"}).id,null);
  assert.deepEqual(analyticsConfig({RAILWAY_ENVIRONMENT_NAME:"staging",GA4_CONSENT_PREVIEW:"true"}),{id:null,preview:true});
  assert.equal(analyticsConfig({RAILWAY_ENVIRONMENT_NAME:"production",GA4_CONSENT_PREVIEW:"true"}).preview,true);
  assert.deepEqual(analyticsConfig({RAILWAY_ENVIRONMENT_NAME:"production",GA4_CONSENT_PREVIEW:"true",GA4_ENABLED:"false",GA4_MEASUREMENT_ID:"G-TEST1234"}),{id:null,preview:true});
  assert.equal(analyticsConfig({RAILWAY_ENVIRONMENT_NAME:"staging",GA4_ENABLED:"true",GA4_MEASUREMENT_ID:"G-TEST1234"}).id,null);
  assert.equal(analyticsConfig({RAILWAY_ENVIRONMENT_NAME:"production",GA4_ENABLED:"true",GA4_MEASUREMENT_ID:"G-TEST1234"}).id,"G-TEST1234");
});
test("consent expires and invalid, future and old-version records fail closed", () => {
  const now=1_000_000_000;
  assert.equal(readConsent(null,now),null);
  assert.equal(readConsent("invalid",now),null);
  assert.equal(readConsent(serializeConsent("granted",now),now),"granted");
  assert.equal(readConsent(serializeConsent("denied",now),now),"denied");
  assert.equal(readConsent(serializeConsent("granted",now),now+CONSENT_TTL),null);
  assert.equal(readConsent(serializeConsent("granted",now+1),now),null);
  assert.equal(readConsent('{"version":0,"choice":"granted","at":1000000000}',now),null);
});
test("private paths and URL parameters never enter the marketing page allowlist", () => {
  assert.ok(publicAnalyticsPage("/"));
  assert.ok(publicAnalyticsPage("/help"));
  for (const path of ["/studio","/account","/projects/secret","/credits","/checkout","/admin","/api/assets","/help?email=x","/__proto__"]) assert.equal(publicAnalyticsPage(path),null);
  assert.equal(sanitizedReferrer("https://example.test/user?email=x#private"),"https://example.test/");
  assert.equal(sanitizedReferrer("javascript:alert(1)"),"");
});

test("only exact, clean marketing URLs are eligible, including the private home carousel exclusion", () => {
  assert.equal(publicAnalyticsLocation("/", "", ""), "SingMotion AI");
  for (const query of ["?card=projects", "?card=login", "?email=synthetic@example.test", "?utm_source=google"]) {
    assert.equal(publicAnalyticsLocation("/", query, ""), null);
  }
  assert.equal(publicAnalyticsLocation("/", "", "#private"), null);
  assert.equal(publicAnalyticsLocation("/studio", "", ""), null);
});
