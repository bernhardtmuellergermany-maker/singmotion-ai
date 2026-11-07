import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CommerceStore,
  disabledPayments,
  type VerifiedPayment,
} from "../lib/commerce/store.ts";
import { berlinDay, reserveDaily } from "../lib/live/daily-budget.ts";
import { LiveTestStore } from "../lib/live/store.ts";
import { parseStudioDraft } from "../lib/studio-draft.ts";
const evidence = "Offline mock reviewed inclusive sale quote, not live pricing";
test("customer accounts, hashed sessions/guest tokens, credit reservation, capture and verified webhook idempotency", async () => {
  const s = new CommerceStore(":memory:");
  try {
    const a = s.register(
        "owner@example.test",
        "long fictional password for tests only",
      ),
      b = s.register(
        "other@example.test",
        "another long fictional password for tests",
      );
    assert.throws(() => s.login("owner@example.test", "wrong"), /credentials/);
    const token = s.login(
      "owner@example.test",
      "long fictional password for tests only",
    );
    assert.equal(s.session(token), a);
    assert.equal(s.session(token, Date.now() + 2 * 86400000), null);
    assert.equal(s.balance(a), 0);
    assert.throws(() =>
      s.grant(a, 1000, { id: "editor", role: "editor" }, evidence, "grant"),
    );
    s.grant(
      a,
      1000,
      { id: "operator", role: "super-admin" },
      evidence,
      "grant",
    );
    s.grant(
      a,
      1000,
      { id: "operator", role: "super-admin" },
      evidence,
      "grant",
    );
    assert.equal(s.balance(a), 1000);
    const order = s.order({
      account: a,
      email: "owner@example.test",
      project: "owned-project",
      cents: 700,
      quoteEvidence: evidence,
      key: "order",
    });
    assert.equal(
      s.order({
        account: a,
        email: "owner@example.test",
        project: "owned-project",
        cents: 700,
        quoteEvidence: evidence,
        key: "order",
      }).id,
      order.id,
    );
    assert.throws(() => s.ownedOrder(order.id, b));
    s.reserveCredit(order.id, a);
    s.reserveCredit(order.id, a);
    assert.equal(s.balance(a), 300);
    const expensive = s.order({
      account: a,
      email: "owner@example.test",
      project: "other-project",
      cents: 400,
      quoteEvidence: evidence,
      key: "other",
    });
    assert.throws(() => s.reserveCredit(expensive.id, a), /Insufficient/);
    s.captureCredit(order.id, a);
    s.captureCredit(order.id, a);
    assert.equal(s.balance(a), 300);
    const guest = s.order({
      account: null,
      email: "guest@example.test",
      project: "guest-owned-project",
      cents: 300,
      quoteEvidence: evidence,
      key: "guest",
    });
    assert.ok(guest.guestToken);
    assert.throws(() => s.ownedOrder(guest.id, null, "wrong"));
    assert.equal(
      s.ownedOrder(guest.id, null, guest.guestToken!).status,
      "awaiting_payment",
    );
    assert.ok(
      !JSON.stringify(
        s.db.prepare("SELECT * FROM customer_orders").all(),
      ).includes(guest.guestToken!),
    );
    await assert.rejects(
      s.webhook(new Uint8Array(), "", disabledPayments),
      /not configured/,
    );
    const receipt: VerifiedPayment = {
      eventId: "event",
      provider: "offline-mock",
      orderId: guest.id,
      cents: 300,
      currency: "EUR",
      evidence,
    };
    const adapter = {
      async verify() {
        return receipt;
      },
    };
    await s.webhook(new Uint8Array(), "mock", adapter);
    await s.webhook(new Uint8Array(), "mock", adapter);
    assert.equal(
      s.ownedOrder(guest.id, null, guest.guestToken!).status,
      "paid",
    );
    assert.equal(
      s.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()!.n,
      1,
    );
    await assert.rejects(
      s.webhook(new Uint8Array(), "mock", {
        async verify() {
          return { ...receipt, cents: 301 };
        },
      }),
      /Conflicting/,
    );
    assert.throws(() =>
      s.refundCredit(order.id, { id: "editor", role: "editor" }, evidence),
    );
    s.refundCredit(order.id, { id: "operator", role: "super-admin" }, evidence);
    s.refundCredit(order.id, { id: "operator", role: "super-admin" }, evidence);
    assert.equal(s.balance(a), 1000);
    s.db
      .prepare("UPDATE customer_orders SET guest_expiry=0 WHERE id=?")
      .run(guest.id);
    assert.throws(() => s.ownedOrder(guest.id, null, guest.guestToken!));
    s.logout(token);
    assert.equal(s.session(token), null);
  } finally {
    s.close();
  }
});
test("Berlin daily cap uses calendar dates across DST, keeps reservations and is idempotent", () => {
  assert.equal(berlinDay(Date.parse("2026-03-29T22:30:00Z")), "2026-03-30");
  assert.equal(berlinDay(Date.parse("2026-10-25T23:30:00Z")), "2026-10-26");
  const s = new LiveTestStore(":memory:");
  try {
    const review = {
      eurPerUsdUpperPpm: 1000000,
      fxFeesMaxMicroEur: 1000000,
      evidence,
      reviewedBy: "test",
      reviewedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    };
    reserveDaily(s.db, "one", 30000000, review);
    reserveDaily(s.db, "one", 30000000, review);
    assert.throws(
      () => reserveDaily(s.db, "two", 20000000, review),
      /DAILY_EUR50/,
    );
    reserveDaily(s.db, "two", 19000000, review);
    assert.throws(() => reserveDaily(s.db, "two", 1, review), /BINDING/);
    assert.equal(
      s.db
        .prepare("SELECT SUM(micro_eur) AS n FROM live_daily_reservations")
        .get()!.n,
      49000000,
    );
    reserveDaily(s.db, "one", 30000000, review, Date.now() + 86400000);
    assert.equal(
      s.db
        .prepare(
          "SELECT COUNT(*) AS n FROM live_daily_reservations WHERE attempt_id='one'",
        )
        .get()!.n,
      2,
    );
  } finally {
    s.close();
  }
});
test("format is optional for historical drafts, exact for new approvals and rejects unknown provider parameters", () => {
  const legacy = {
    version: 1,
    owner: "owner",
    songId: "song",
    imageId: "image",
    start: 0,
    end: 5,
    performance: "Natural",
    camera: "Static Close-Up",
    customPrompt: "",
  };
  assert.deepEqual(parseStudioDraft(legacy), legacy);
  for (const outputFormat of ["9:16", "16:9"] as const)
    assert.equal(
      parseStudioDraft({ ...legacy, outputFormat }).outputFormat,
      outputFormat,
    );
  assert.throws(() => parseStudioDraft({ ...legacy, outputFormat: "4:3" }));
  assert.throws(() => parseStudioDraft({ ...legacy, providerAspect: "16:9" }));
});

test("two independent SQLite connections cannot over-reserve customer credit", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path"),
    { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util"),
    { pathToFileURL } = await import("node:url");
  const root = await mkdtemp(path.join(tmpdir(), "sm-credit-race-")),
    file = path.join(root, "commerce.sqlite"),
    s = new CommerceStore(file);
  try {
    const account = s.register(
      "race@example.test",
      "long offline-only test password for race",
    );
    s.grant(
      account,
      500,
      { id: "operator", role: "super-admin" },
      evidence,
      "funding",
    );
    const ids = ["a", "b"].map(
      (key) =>
        s.order({
          account,
          email: "race@example.test",
          project: key,
          cents: 300,
          quoteEvidence: evidence,
          key,
        }).id,
    );
    const source = `import {CommerceStore} from ${JSON.stringify(pathToFileURL(path.resolve("lib/commerce/store.ts")).href)};const s=new CommerceStore(process.argv[1]);try{s.reserveCredit(process.argv[2],process.argv[3]);process.stdout.write("reserved");}catch{process.stdout.write("blocked");}finally{s.close();}`;
    const results = await Promise.all(
      ids.map((id) =>
        promisify(execFile)(process.execPath, [
          "--experimental-strip-types",
          "--input-type=module",
          "-e",
          source,
          file,
          id,
          account,
        ]),
      ),
    );
    assert.deepEqual(results.map((r) => r.stdout).sort(), [
      "blocked",
      "reserved",
    ]);
    assert.equal(s.balance(account), 200);
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});
