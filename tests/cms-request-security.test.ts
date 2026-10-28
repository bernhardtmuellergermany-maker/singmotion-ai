import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cmsOriginFailure,
  cmsLoginDiagnostic,
  annotateCmsFailure,
} from "../cms/request-security.ts";
const origin = "https://staging.example.test";
test("CMS mutations require exact configured origin even behind a TLS terminator", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.equal(
      cmsOriginFailure(
        method,
        new Headers({
          origin,
          host: "internal:3000",
          "x-forwarded-proto": "http",
        }),
        origin,
      ),
      null,
    );
    for (const bad of [
      "null",
      "http://staging.example.test",
      "https://evil.test",
      origin + "/",
      origin + ".evil.test",
      origin + ", https://evil.test",
    ]) {
      assert.equal(
        cmsOriginFailure(
          method,
          new Headers({
            origin: bad,
            "x-forwarded-host": "staging.example.test",
            referer: origin + "/admin/login",
          }),
          origin,
        ),
        "CMS_ORIGIN_REJECTED",
      );
    }
    assert.equal(
      cmsOriginFailure(
        method,
        new Headers({
          referer: origin + "/admin/login",
          "sec-fetch-site": "same-origin",
        }),
        origin,
      ),
      "CMS_ORIGIN_MISSING",
    );
    assert.equal(
      cmsOriginFailure(method, new Headers({ origin }), undefined),
      "CMS_ORIGIN_REJECTED",
    );
  }
  assert.equal(cmsOriginFailure("GET", new Headers(), origin), null);
});
test("login diagnostics distinguish authentication and access without inspecting private response data", () => {
  assert.equal(cmsLoginDiagnostic(401), "CMS_AUTH_REJECTED");
  assert.equal(cmsLoginDiagnostic(403), "CMS_ACCESS_DENIED");
  assert.equal(cmsLoginDiagnostic(429), "CMS_RATE_LIMITED");
  assert.equal(cmsLoginDiagnostic(200), null);
});
test("rejection logs only fixed category and status; preserves response", async (t) => {
  const entries: unknown[] = [];
  t.mock.method(console, "warn", (value: unknown) => entries.push(value));
  const response = annotateCmsFailure(
    Response.json({ error: "private sentinel" }, { status: 403 }),
    "CMS_ORIGIN_REJECTED",
  );
  assert.equal(
    response.headers.get("X-SingMotion-CMS-Code"),
    "CMS_ORIGIN_REJECTED",
  );
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(entries, [
    JSON.stringify({
      event: "cms_request_rejected",
      code: "CMS_ORIGIN_REJECTED",
      status: 403,
    }),
  ]);
  assert.deepEqual(await response.json(), { error: "private sentinel" });
});
