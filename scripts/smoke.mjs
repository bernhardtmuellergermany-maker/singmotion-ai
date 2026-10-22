import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3000";
const response = await fetch(`${base}/studio`);
assert.equal(response.status, 200);
assert.match(await response.text(), /Create your/);
const session = await fetch(`${base}/api/session`, {
  method: "POST",
  headers: { Origin: base },
});
assert.equal(session.status, 200);
const cookie = session.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "Session cookie must be issued.");
const quote = await fetch(`${base}/api/quote`, {
  method: "POST",
  headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ duration: 10 }),
});
assert.equal(quote.status, 200);
const price = await quote.json();
assert.equal(price.currency, "EUR");
assert.ok(price.cents > 0);
const heartbeat = await stat(
  path.join(process.env.DATA_DIR || ".data", "worker-heartbeat"),
);
assert.ok(Date.now() - heartbeat.mtimeMs < 180000, "Start the demo worker.");
// Remove this health-check session; no media or user data is created.
const deleted = await fetch(`${base}/api/account`, {
  method: "DELETE",
  headers: { Origin: base, Cookie: cookie },
});
assert.equal(deleted.status, 200);
console.log(
  "Studio HTML, private session, server quote, worker heartbeat, and session cleanup verified.",
);
