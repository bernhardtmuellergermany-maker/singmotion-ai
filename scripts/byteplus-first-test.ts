// Manual operator entrypoint only. Never invoked by web, worker, build or deployment.
import path from "node:path";
import { readFile, stat, realpath, chmod, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
process.umask(0o077);
const [action, ...args] = process.argv.slice(2);
let store: import("../lib/live/store.ts").LiveTestStore | undefined;
let delivery: import("../lib/live/r2.ts").R2PrivateInputDelivery | undefined;
let appDb: { close(): void } | undefined;
try {
  const values: Record<string, string> = {};
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--skip-download") {
      if (switches.has(flag)) throw Error();
      switches.add(flag);
      continue;
    }
    if (
      ![
        "--plan",
        "--owner",
        "--review-file",
        "--write-review",
        "--confirm-live-test",
        "--output-review-file",
        "--write-output-review",
        "--confirm-output",
      ].includes(flag) ||
      values[flag] !== undefined ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error();
    values[flag] = args[++i];
  }
  if (
    ![
      "dry-run",
      "run",
      "resume",
      "cancel",
      "result",
      "cleanup",
      "review-output",
      "download",
      "refresh-result",
    ].includes(action) ||
    !values["--plan"] ||
    !values["--owner"] ||
    (action !== "dry-run" && values["--write-review"]) ||
    (action === "review-output" && !values["--review-file"]) ||
    (values["--write-output-review"] && action !== "review-output") ||
    (action === "download" &&
      (switches.has("--skip-download") ||
        !values["--output-review-file"] ||
        !values["--confirm-output"])) ||
    (action !== "dry-run" &&
      action !== "result" &&
      action !== "review-output" &&
      ((action !== "download" && !switches.has("--skip-download")) ||
        !values["--review-file"] ||
        !values["--confirm-live-test"]))
  )
    throw Error();
  if (!process.env.DATA_DIR) throw Error();
  const root = await realpath(process.env.DATA_DIR);
  const ledger = path.join(root, "live-test.sqlite");
  if (!(await stat(ledger)).isFile() || (await realpath(ledger)) !== ledger)
    throw Error();
  await chmod(ledger, 0o600);
  const { LiveTestStore } = await import("../lib/live/store.ts");
  const { FirstTestWorkflow, firstTestConfig } =
    await import("../lib/live/first-test.ts");
  appDb = (await import("../lib/db.ts")).db;
  store = new LiveTestStore(ledger);
  for (const suffix of ["-wal", "-shm"])
    await chmod(ledger + suffix, 0o600).catch(() => {});
  const id = values["--plan"],
    owner = values["--owner"];
  let review: unknown;
  if (values["--review-file"]) {
    if ((await stat(values["--review-file"])).size > 65536) throw Error();
    review = JSON.parse(
      (await readFile(values["--review-file"], "utf8")).replace(/^\uFEFF/, ""),
    );
  }
  let transport: import("../lib/live/byteplus.ts").Transport = async () => {
    throw Error("Offline only");
  };
  let inputDelivery: import("../lib/live/byteplus.ts").PrivateInputDelivery = {
    issue: async () => {
      throw Error("Offline only");
    },
  };
  let inputHosts: readonly string[] = [];
  if (!["dry-run", "result", "review-output"].includes(action)) {
    firstTestConfig(process.env, id); // Before credentials or any network-capable client.
    const { validateFirstTestReview } =
      await import("../lib/live/first-test.ts");
    const attempt = store.get(id);
    if (
      attempt.media.owner !== owner ||
      validateFirstTestReview(review, attempt).digest !==
        values["--confirm-live-test"]
    )
      throw Error();
    if (action !== "download") {
      const { createSignedTransport } =
        await import("../lib/live/signed-transport.ts");
      const { loadBytePlusCredentials } =
        await import("../lib/live/signing.ts");
      loadBytePlusCredentials(); // Fail early, before claiming the one-time slot.
      transport = createSignedTransport(fetch);
    }
    // Poll/resume/cancel need no R2 credentials, upload client or delivery.
    if (action === "run" || action === "cleanup") {
      const { R2PrivateInputDelivery } = await import("../lib/live/r2.ts");
      delivery = new R2PrivateInputDelivery(store, root);
      inputDelivery = delivery;
      inputHosts = delivery.inputHosts;
    }
  }
  const workflow = new FirstTestWorkflow(
    store,
    root,
    process.env,
    transport,
    inputDelivery,
    inputHosts,
  );
  const printResult = () =>
    console.log(
      JSON.stringify(
        {
          planId: id,
          state: workflow.owned(id, owner).state,
          providerJobId: store!.get(id).providerJobId,
          observation: store!.firstTestResult(id),
          outputPath: store!.get(id).outputPath,
          automaticDownload: false,
        },
        null,
        2,
      ),
    );
  if (action === "dry-run") {
    const report = await workflow.dryRun(id, owner, review);
    if (values["--write-review"])
      await writeFile(
        values["--write-review"],
        JSON.stringify(report.review, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    console.log(JSON.stringify(report, null, 2));
  } else if (action === "review-output") {
    const { validateFirstTestReview } =
      await import("../lib/live/first-test.ts");
    const { outputReviewTemplate, reviewOutput } =
      await import("../lib/live/first-test-download.ts");
    const checked = validateFirstTestReview(review, workflow.owned(id, owner));
    if (checked.digest !== store.get(id).contractDigest) throw Error();
    if (values["--output-review-file"]) {
      if ((await stat(values["--output-review-file"])).size > 65536)
        throw Error();
      const input = JSON.parse(
        (await readFile(values["--output-review-file"], "utf8")).replace(
          /^\uFEFF/,
          "",
        ),
      );
      const approved = reviewOutput(
        workflow,
        id,
        owner,
        input,
        checked.review.generatedVideoMaxSeconds!,
      );
      console.log(
        JSON.stringify(
          {
            outputReview: approved.review,
            confirmationDigest: approved.digest,
            networkRequests: 0,
          },
          null,
          2,
        ),
      );
    } else {
      const template = outputReviewTemplate(workflow, id, owner);
      if (values["--write-output-review"])
        await writeFile(
          values["--write-output-review"],
          JSON.stringify(template, null, 2),
          { flag: "wx", mode: 0o600 },
        );
      console.log(
        JSON.stringify(
          {
            outputReview: template,
            confirmationDigest: null,
            networkRequests: 0,
          },
          null,
          2,
        ),
      );
    }
  } else if (action === "download") {
    if ((await stat(values["--output-review-file"])).size > 65536)
      throw Error();
    const outputReview = JSON.parse(
      (await readFile(values["--output-review-file"], "utf8")).replace(
        /^\uFEFF/,
        "",
      ),
    );
    const { downloadFirstTestResult } =
      await import("../lib/live/first-test-download.ts");
    await downloadFirstTestResult(
      workflow,
      id,
      owner,
      review,
      values["--confirm-live-test"],
      outputReview,
      values["--confirm-output"],
    );
    printResult();
  } else if (action === "refresh-result") {
    await workflow.refreshResult(
      id,
      owner,
      review,
      values["--confirm-live-test"],
    );
    printResult();
  } else if (action === "result") {
    printResult(); // Local private read only; may print an expired bearer URL.
  } else if (action === "cleanup") {
    const slot = store.firstTest();
    if (
      !slot ||
      slot.attempt_id !== id ||
      slot.digest !== values["--confirm-live-test"]
    )
      throw Error();
    await delivery!.cleanupExpired(id, AbortSignal.timeout(60000));
    console.log(JSON.stringify({ planId: id, cleanup: "completed" }));
  } else if (action === "cancel") {
    await workflow.cancel(id, owner, review, values["--confirm-live-test"]);
    printResult();
  } else {
    if (action === "run") {
      const submitted = await workflow.submit(
        id,
        owner,
        review,
        values["--confirm-live-test"],
      );
      console.log(
        JSON.stringify({
          planId: id,
          state: submitted.state,
          providerJobId: submitted.providerJobId,
        }),
      );
      if (submitted.state !== "submitted") throw Error();
    }
    const slot = store.firstTest();
    if (
      !slot ||
      slot.attempt_id !== id ||
      slot.digest !== values["--confirm-live-test"]
    )
      throw Error();
    while (true) {
      const attempt = workflow.owned(id, owner);
      if (["output_observed", "completed", "failed"].includes(attempt.state)) {
        printResult();
        break;
      }
      if (Date.now() >= slot.claimed_at + 12 * 3600000) throw Error();
      const result = await workflow.poll(
        id,
        owner,
        review,
        values["--confirm-live-test"],
      );
      if (["output_observed", "completed", "failed"].includes(result.state)) {
        printResult();
        break;
      }
      console.log(
        JSON.stringify({
          planId: id,
          state: result.state,
          providerJobId: result.providerJobId,
        }),
      );
      await delay(15000); // Read-only polling, never submit retry or automatic cancel.
    }
  }
} catch {
  // No raw provider, filesystem, credential or signed-input diagnostics.
  console.error(
    "First-test command stopped. Check arguments, gates, exact review/digest and private plan. Use result to inspect durable state; resume only a persisted task. Never rerun or reset an uncertain submission. No automatic retry was performed.",
  );
  process.exitCode = 1;
} finally {
  delivery?.client.destroy();
  store?.close();
  appDb?.close();
}
