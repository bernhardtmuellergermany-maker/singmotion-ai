import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLink, publicSiteLink, hasRole, cmsEnvironment, pageSlugs } from "../cms/policy.ts";
test("CMS roles require the dedicated staff collection; customer identities cannot escalate", () => {
  for (const user of [
    null,
    { role: "super-admin" },
    { collection: "customers", role: "super-admin" },
    { collection: "staff", role: "customer" },
  ])
    assert.equal(hasRole(user, ["super-admin", "editor", "support"]), false);
  assert.equal(
    hasRole({ collection: "staff", role: "editor" }, ["super-admin", "editor"]),
    true,
  );
  assert.equal(
    hasRole({ collection: "staff", role: "support" }, [
      "super-admin",
      "editor",
    ]),
    false,
  );
});
test("CMS links reject scripts, protocol-relative URLs, credentials and encoded separators", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.example",
    "/\\evil.example",
    "/a\nheader",
    "https://user:secret@example.com",
    "/x%2f%2fevil.example",
    "http://example.com",
  ])
    assert.equal(safeLink(url), false, url);
  for (const url of ["/studio", "/privacy", "https://example.com/legal"])
    assert.equal(safeLink(url), true);
  for (const name of ["admin", "api", "studio", "cms-preview"])
    assert.equal(pageSlugs.includes(name), false);
});
test("CMS configuration fails closed without dedicated server secrets and HTTPS", () => {
  assert.doesNotThrow(() => cmsEnvironment({}));
  for (const env of [
    {},
    { PAYLOAD_SECRET: "x".repeat(40) },
    {
      PAYLOAD_SECRET: "x".repeat(40),
      CMS_DATABASE_URL: "postgres://localhost/test",
      CMS_ORIGIN: "http://example.com",
    },
  ])
    assert.throws(() => cmsEnvironment({ CMS_ENABLED: "true", ...env }));
  assert.doesNotThrow(() =>
    cmsEnvironment({
      CMS_ENABLED: "true",
      PAYLOAD_SECRET: "x".repeat(40),
      CMS_DATABASE_URL: "postgres://localhost/test",
      CMS_ORIGIN: "https://staging.example.com",
    }),
  );
});

test("Public CMS hero and CTA links cannot send visitors to outside websites",()=>{
 for(const value of ["/studio","/help","/help/camera-movements","/legal#privacy"])
  assert.equal(publicSiteLink(value),true,value);
 for(const value of ["https://example.com/legal","https://github.com","https://docs.byteplus.com",
  "https://omnihumanai.net","//external.example","javascript:alert(1)","/x%2f%2fevil.example",null])
  assert.equal(publicSiteLink(value),false,String(value));
});
