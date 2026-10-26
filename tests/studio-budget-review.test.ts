import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveTestStore, confirmationPhrase } from "../lib/live/store.ts";
import {
  offerStudioBudget,
  authorizeStudioBudget,
  latestStudioBudget,
  studioReservedUsd,
  studioBudgetAcknowledgment,
} from "../lib/live/studio-budget-review.ts";
import { euroBudget } from "../lib/live/studio-budget.ts";
import { studioStaff } from "../cms/studio-access.ts";
const http: typeof fetch = async () =>
  new Response(
    `<Cube time='${new Date().toISOString().slice(0, 10)}'><Cube currency='USD' rate='1.1'/></Cube>`,
  );
function fixture() {
  const store = new LiveTestStore(":memory:");
  const a = store.prepare(
    {
      sourceJobId: "historical",
      owner: "owner",
      audioPath: "unused",
      audioSha256: "a".repeat(64),
      imagePath: "unused",
      imageSha256: "b".repeat(64),
      durationSeconds: 5,
      prompt: "Sing",
      promptLanguageConfirmed: true,
    },
    "mock",
    8640000,
  );
  store.db
    .prepare("UPDATE live_attempts SET reserved_micro_usd=?,data=? WHERE id=?")
    .run(
      8640000,
      JSON.stringify({
        ...a,
        state: "failed",
        providerJobId: "historical-task",
      }),
      a.id,
    );
  store.db
    .prepare("INSERT INTO live_first_test VALUES (1,?,?,?)")
    .run(a.id, "untouched", Date.now());
  return { store, a };
}
test("Studio renewal retains USD 8.64, ignores claimed operator slot and preserves audit across renewals", async () => {
  const { store, a } = fixture();
  try {
    const original = store.get(a.id),
      slot = store.firstTest();
    const offer = await offerStudioBudget(
      store.db,
      "staff",
      "owner",
      50000000,
      http,
    );
    assert.equal(offer.budget.reservedMicroUsd, 8640000);
    assert.equal(latestStudioBudget(store.db), undefined);
    assert.throws(
      () =>
        authorizeStudioBudget(
          store.db,
          "staff",
          "owner",
          50000000,
          offer.id,
          "",
        ),
      /Explicit/,
    );
    assert.throws(
      () =>
        authorizeStudioBudget(
          store.db,
          "other",
          "owner",
          50000000,
          offer.id,
          studioBudgetAcknowledgment,
        ),
      /not yours/,
    );
    assert.throws(
      () =>
        authorizeStudioBudget(
          store.db,
          "staff",
          "other",
          50000000,
          offer.id,
          studioBudgetAcknowledgment,
        ),
      /not yours/,
    );
    const saved = authorizeStudioBudget(
      store.db,
      "staff",
      "owner",
      50000000,
      offer.id,
      studioBudgetAcknowledgment,
    );
    assert.equal(
      saved.budget.remainingMicroEur,
      50000000 - 10000000 - Math.ceil((8640000 * 1818182) / 1000000),
    );
    assert.equal(saved.budget.basis, "planning-allowance");
    assert.throws(
      () =>
        authorizeStudioBudget(
          store.db,
          "staff",
          "owner",
          50000000,
          offer.id,
          studioBudgetAcknowledgment,
        ),
      /already used/,
    );
    const renewed = await offerStudioBudget(
      store.db,
      "staff",
      "owner",
      50000000,
      http,
    );
    authorizeStudioBudget(
      store.db,
      "staff",
      "owner",
      50000000,
      renewed.id,
      studioBudgetAcknowledgment,
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) n FROM live_studio_budget_reviews")
        .get()!.n,
      2,
    );
    assert.equal(studioReservedUsd(store.db), 8640000);
    assert.deepEqual(store.get(a.id), original);
    assert.deepEqual(store.firstTest(), slot);
  } finally {
    store.close();
  }
});
test("stale rates, changed reservations/caps and expired offers fail closed", async () => {
  const { store, a } = fixture();
  try {
    await assert.rejects(
      offerStudioBudget(
        store.db,
        "staff",
        "owner",
        50000000,
        async () =>
          new Response(
            "<Cube time='2000-01-01'><Cube currency='USD' rate='1.1'/></Cube>",
          ),
      ),
      /stale/,
    );
    await assert.rejects(
      offerStudioBudget(store.db, "staff", "owner", 50000000, async () => {
        throw Error("private upstream detail");
      }),
      /network/,
    );
    const offer = await offerStudioBudget(
      store.db,
      "staff",
      "owner",
      50000000,
      http,
    );
    assert.throws(
      () =>
        authorizeStudioBudget(
          store.db,
          "staff",
          "owner",
          10000000,
          offer.id,
          studioBudgetAcknowledgment,
        ),
      /cap changed/,
    );
    store.db
      .prepare("UPDATE live_attempts SET reserved_micro_usd=9000000 WHERE id=?")
      .run(a.id);
    assert.throws(
      () =>
        authorizeStudioBudget(
          store.db,
          "staff",
          "owner",
          50000000,
          offer.id,
          studioBudgetAcknowledgment,
        ),
      /Reservations/,
    );
    store.db
      .prepare("UPDATE live_studio_budget_offers SET expires=0 WHERE id=?")
      .run(offer.id);
    assert.throws(
      () =>
        authorizeStudioBudget(
          store.db,
          "staff",
          "owner",
          50000000,
          offer.id,
          studioBudgetAcknowledgment,
        ),
      /expired/,
    );
    assert.equal(latestStudioBudget(store.db), undefined);
  } finally {
    store.close();
  }
});
test("reservation transaction uses latest renewal, preserves USD cap and uncertain lock", async () => {
  const { store, a } = fixture();
  try {
    const offer = await offerStudioBudget(
      store.db,
      "staff",
      "owner",
      50000000,
      http,
    );
    authorizeStudioBudget(
      store.db,
      "staff",
      "owner",
      50000000,
      offer.id,
      studioBudgetAcknowledgment,
    );
    const cfg = {
      demoMode: false,
      enabled: true,
      operatorSecret: "mock-private-secret-at-least-32-characters",
      maxJobMicroUsd: 20000000,
      maxTotalMicroUsd: 50000000,
      maxDurationSeconds: 60,
      eurBudget: {
        ...latestStudioBudget(store.db)!,
        eurPerUsdUpperPpm: 1,
        fxFeesMaxMicroEur: 0,
      },
    };
    const fresh = store.prepare(
      { ...a.media, sourceJobId: "studio-new" },
      "mock",
      20000000,
    );
    assert.throws(
      () =>
        store.authorize(
          fresh.id,
          cfg,
          cfg.operatorSecret,
          confirmationPhrase(fresh),
        ),
      /Total live-test spending cap/,
    );
    assert.equal(studioReservedUsd(store.db), 8640000);
    assert.equal(
      euroBudget(latestStudioBudget(store.db), 8640000, 9000000)
        .remainingMicroUsd,
      360000,
    );
    store.db
      .prepare("UPDATE live_attempts SET data=? WHERE id=?")
      .run(JSON.stringify({ ...store.get(a.id), state: "uncertain" }), a.id);
    assert.throws(
      () =>
        store.authorize(
          fresh.id,
          cfg,
          cfg.operatorSecret,
          confirmationPhrase(fresh),
        ),
      /ONE_ACTIVE_GENERATION/,
    );
    store.db
      .prepare("UPDATE live_attempts SET data=? WHERE id=?")
      .run(JSON.stringify({ ...store.get(a.id), state: "failed" }), a.id);
    store.db.prepare("UPDATE live_studio_budget_reviews SET review_json=?").run(
      JSON.stringify({
        ...latestStudioBudget(store.db),
        validUntil: "2000-01-01",
      }),
    );
    assert.throws(
      () =>
        store.authorize(
          fresh.id,
          cfg,
          cfg.operatorSecret,
          confirmationPhrase(fresh),
        ),
      /EUR50_REVIEW_REQUIRED/,
    );
  } finally {
    store.close();
  }
});
test("budget POST uses existing Super Admin allowlist and exact Origin protections", () => {
  const env = {
    CMS_ENABLED: "true",
    CMS_ORIGIN: "https://staging.example.test",
    BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS: "admin",
  };
  assert.equal(
    studioStaff(
      { id: "admin", collection: "staff", role: "super-admin" },
      "POST",
      new Headers({ origin: env.CMS_ORIGIN }),
      env,
    ),
    "cms-staff-admin",
  );
  for (const user of [
    null,
    { id: "admin", collection: "staff", role: "editor" },
    { id: "other", collection: "staff", role: "super-admin" },
  ])
    assert.throws(() =>
      studioStaff(user, "POST", new Headers({ origin: env.CMS_ORIGIN }), env),
    );
  assert.throws(() =>
    studioStaff(
      { id: "admin", collection: "staff", role: "super-admin" },
      "POST",
      new Headers({ origin: "https://evil.example" }),
      env,
    ),
  );
});
