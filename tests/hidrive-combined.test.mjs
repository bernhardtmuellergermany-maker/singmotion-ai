import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectResiduals,
  residualNames,
} from "../lib/ops/hidrive-residual-check.mjs";
import { validateRuntimeKeys, keyId } from "../lib/ops/backup-key-policy.mjs";
import { createCombinedBundle } from "../scripts/hidrive-test-bundle.mjs";
import {
  receiverEnvironment,
  validateIntegration,
} from "../scripts/hidrive-private-integration.mjs";
import {
  runCombinedTest,
  worker,
} from "../scripts/hidrive-combined-controller.mjs";

test("immutable three-file inspection: exact GET scope, absence and bounded hashes", async () => {
  const calls = [],
    reports = [];
  const result = await inspectResiduals(
    {
      dir: "/private",
      request: async (...args) => {
        calls.push(args);
        return calls.length === 2
          ? new Response(null, { status: 404 })
          : new Response("artificial");
      },
    },
    (x) => reports.push(x),
  );
  assert.equal(calls.length, 3);
  calls.forEach((c, i) =>
    assert.deepEqual(c, [
      "GET",
      "/file",
      { path: "/private/" + residualNames[i] },
      null,
    ]),
  );
  assert.equal(result[1].state, "absent");
  assert.equal(result[0].bytes, 10);
  assert.match(result[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, reports);
  assert.ok(!JSON.stringify(reports).includes("/private"));
});
test("inspection fails closed on rejection, header overflow, streaming overflow and truncation", async () => {
  for (const response of [
    new Response("sensitive", { status: 403 }),
    new Response("x", { headers: { "content-length": "1048577" } }),
    new Response(Buffer.alloc(1048577)),
    new Response("x", { headers: { "content-length": "20" } }),
  ]) {
    let calls = 0;
    const logs = [];
    await assert.rejects(
      inspectResiduals(
        {
          dir: "/private",
          request: async () => {
            calls++;
            return response;
          },
        },
        (x) => logs.push(x),
      ),
    );
    assert.equal(calls, 1);
    assert.deepEqual(logs, []);
  }
});
test("fresh role-separated bundle, expiring activation, key identity and invalid certificate rejection", async () => {
  const bundle = await createCombinedBundle();
  const env = receiverEnvironment({
    RAILWAY_SERVICE_NAME: "singmotion-backup",
    BACKUP_ENABLED: "false",
    ...bundle.receiver,
  });
  validateRuntimeKeys(env);
  validateRuntimeKeys(bundle.sender);
  validateRuntimeKeys(bundle.restore);
  assert.ok(!bundle.sender.BACKUP_RECOVERY_PRIVATE_KEY_B64);
  assert.ok(!bundle.restore.BACKUP_SIGNING_PRIVATE_KEY_B64);
  assert.equal(
    keyId(Buffer.from(bundle.sender.BACKUP_RECOVERY_PUBLIC_KEY_B64, "base64")),
    keyId(
      Buffer.from(bundle.restore.BACKUP_RECOVERY_PRIVATE_KEY_B64, "base64"),
    ),
  );
  assert.throws(() =>
    validateRuntimeKeys({
      ...bundle.sender,
      BACKUP_TEST_EXPIRES_AT: new Date(0).toISOString(),
    }),
  );
  assert.throws(() =>
    validateRuntimeKeys({
      ...bundle.sender,
      BACKUP_TEST_WRITER_KEY_B64: bundle.restore.BACKUP_TEST_READER_KEY_B64,
    }),
  );
  assert.throws(() =>
    validateIntegration({ ...bundle.sender, HIDRIVE_CLIENT_SECRET: "never" }),
  );
});

function fixture(failAt = null, residualOrder = [1, 2, 3], partialFirst = false) {
  const original = "d36acf6d8f5b268ffef907c53f0524c90d7b852f",
    commit = "a".repeat(40),
    clock = Date.now();
  const originalIds = [
    worker,
    "2c6bca77-61e6-4ab5-9447-fa23767622aa",
    "10a10398-e2b8-45bf-a8f5-298999904358",
  ];
  const services = new Map(
    originalIds.map((id, i) => [
      id,
      {
        id,
        name: i ? "original-" + i : "singmotion-backup",
        volumeMounts: [],
        latestDeployment: { id: "old-" + i },
        stagedChangeCount: 0,
      },
    ]),
  );
  const config = {
    source: { commitSha: original },
    build: { dockerfilePath: "Dockerfile.backup" },
    deploy: { restartPolicyType: "NEVER" },
  };
  const calls = [],
    events = [],
    staged = new Set(),
    sources = new Map(),
    deploys = new Map(),
    markers = new Map();
  let sequence = 0,
    failed = false,
    receiverLogReads = 0;
  const putDeployment = (id, sha, marker) => {
    const d = {
      id: "deploy-" + ++sequence,
      meta: { commitHash: sha },
      status: "SUCCESS",
      createdAt: new Date(clock + 1).toISOString(),
    };
    deploys.set(id, d);
    markers.set(d.id, marker);
    services.get(id).latestDeployment = d;
    return d;
  };
  const tools = new Proxy(
    {},
    {
      get: (_o, full) => async (args) => {
        const name = full.replace("mcp__codex_apps__railway_", "");
        calls.push({ name, serviceId: args.serviceId });
        if (name === failAt && !failed) {
          failed = true;
          throw Error("simulated");
        }
        let data = {};
        if (name === "describe_environment")
          data = {
            services: [...services.values()],
            buckets: [],
            volumes: [],
            staged: staged.size ? {} : null,
          };
        if (name === "describe_service")
          data = {
            config,
            domains: { serviceDomains: [], customDomains: [] },
            tcpProxies: [],
            volumes: [
              {
                id: "00e52dae-7be6-45aa-9e2d-898404b2c17e",
                mountPath: "/state",
              },
            ],
          };
        if (name === "create_service") {
          const id = args.name;
          services.set(id, {
            id,
            name: id,
            volumeMounts: [],
            stagedChangeCount: 0,
          });
          data = { service: { id } };
        }
        if (name === "delete_service") services.delete(args.serviceId);
        if (name === "connect_service_source") {
          sources.set(args.serviceId, args.commitSha);
          staged.add(args.serviceId);
          services.get(args.serviceId).stagedChangeCount++;
          if (args.serviceId === worker)
            config.source.commitSha = args.commitSha;
        }
        if (name === "update_service" && args.serviceId === worker)
          config.build.dockerfilePath = args.dockerfilePath;
        if (name === "accept_deploy") {
          for (const id of staged) {
            const sha = sources.get(id);
            const marker =
              id === worker
                ? sha === original
                  ? "HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER"
                  : "HIDRIVE_SYNTHETIC_PRIVATE_RECEIVER_READY"
                : id.includes("sender")
                  ? "HIDRIVE_SYNTHETIC_SENDER_COMPLETED"
                  : "HIDRIVE_INDEPENDENT_RESTORE_VERIFIED";
            putDeployment(id, sha, marker);
            services.get(id).stagedChangeCount = 0;
          }
          staged.clear();
        }
        if (name === "redeploy")
          data = {
            deployment: putDeployment(
              worker,
              original,
              "HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER",
            ),
          };
        if (name === "list_deployments")
          data = {
            deployments: deploys.has(args.serviceId)
              ? [deploys.get(args.serviceId)]
              : [],
          };
        if (name === "get_logs") {
          let message = markers.get(args.deploymentId);
          if (message === "HIDRIVE_INDEPENDENT_RESTORE_VERIFIED")
            message +=
              " " +
              JSON.stringify({
                run: "run",
                restoreServiceId: "backup230-hidrive-restore",
                artificialData: true,
                signature: true,
                ciphertextSha256: true,
                aead: true,
                plaintextSha256: true,
              });
          // READY may appear before the collector indexes all residual logs.
          const pending =
            partialFirst &&
            message === "HIDRIVE_SYNTHETIC_PRIVATE_RECEIVER_READY" &&
            receiverLogReads++ === 0;
          data = {
            deploy: [
              { message },
              ...(pending ? residualOrder.slice(0, 1) : residualOrder).map(
                (ordinal) => ({
                  message:
                    "HIDRIVE_RESIDUAL_RESULT " +
                    JSON.stringify({ ordinal, state: "absent" }),
                }),
              ),
              ...(!pending
                ? [{ message: "HIDRIVE_RESIDUAL_CHECK_COMPLETED" }]
                : []),
              { message: "HIDRIVE_SYNTHETIC_REMOTE_COMMIT_VERIFIED" },
            ],
          };
        }
        return { structuredContent: data };
      },
    },
  );
  return {
    tools,
    approval: "ONE_SYNTHETIC_COMBINED_RUN_WITH_ROLLBACK",
    commit,
    bundle: { sender: { BACKUP_RUN_ID: "run" }, restore: {}, receiver: {} },
    journal: async (x) => events.push(structuredClone(x)),
    now: () => clock,
    pause: async () => {},
    calls,
    services,
    config,
    events,
  };
}
test("controller sequences inspection/upload/restore and always reuses original build", async () => {
  const f = fixture();
  const result = await runCombinedTest(f);
  assert.equal(result.events.at(-1).event, "ROLLBACK_VERIFIED");
  assert.equal(f.services.size, 3);
  assert.equal(
    f.config.source.commitSha,
    "d36acf6d8f5b268ffef907c53f0524c90d7b852f",
  );
  assert.equal(f.calls.filter((x) => x.name === "create_service").length, 2);
  assert.equal(f.calls.filter((x) => x.name === "redeploy").length, 1);
});
test("controller accepts out-of-order Railway residual logs and rejects duplicate/missing ordinals", async () => {
  const reordered = fixture(null, [3, 1, 2]);
  const result = await runCombinedTest(reordered);
  const inspected = result.events.find((e) => e.event === "RESIDUAL_CHECK_COMPLETED");
  assert.deepEqual(inspected.results.map((x) => x.ordinal), [1, 2, 3]);
  assert.equal(result.events.at(-1).event, "ROLLBACK_VERIFIED");
  assert.equal(reordered.services.size, 3);
  for (const invalidOrder of [[3, 1, 1], [3, 1]]) {
    const invalid = fixture(null, invalidOrder);
    await assert.rejects(
      runCombinedTest(invalid),
      /COMBINED_TEST_FAILED_ROLLBACK_VERIFIED/,
    );
    assert.equal(invalid.services.size, 3);
    assert.ok(
      !invalid.calls.some(
        (x) => x.name === "connect_service_source" &&
          x.serviceId === "backup230-hidrive-sender",
      ),
    );
  }
});

test("controller waits for delayed Railway evidence rather than aborting or replaying", async () => {
  const f = fixture(null, [3, 1, 2], true);
  const result = await runCombinedTest(f);
  const inspected = result.events.find((e) => e.event === "RESIDUAL_CHECK_COMPLETED");
  assert.deepEqual(inspected.results.map((x) => x.ordinal), [1, 2, 3]);
  assert.equal(result.events.at(-1).event, "ROLLBACK_VERIFIED");
  assert.equal(f.calls.filter((x) => x.name === "create_service").length, 2);
  assert.equal(f.services.size, 3);
});

test("controller rolls back activation failure and cleans up partial provisioning without replay", async () => {
  for (const failure of ["set_variables", "accept_deploy"]) {
    const f = fixture(failure);
    await assert.rejects(
      runCombinedTest(f),
      /COMBINED_TEST_FAILED_ROLLBACK_VERIFIED/,
    );
    assert.equal(f.services.size, 3);
    assert.equal(f.events.at(-1).events.at(-1).event, "ROLLBACK_VERIFIED");
  }
  const f = fixture();
  await assert.rejects(runCombinedTest({ ...f, approval: "" }), /APPROVAL/);
  assert.equal(f.calls.length, 0);
});

test("restore enforces signed recovery/signing key IDs before artifact access", async () => {
  const { generateKeyPairSync, randomUUID, sign } = await import("node:crypto");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { encryptFile } = await import("../lib/ops/cloud-backup.mjs");
  const { verifySyntheticRecovery } =
    await import("../scripts/hidrive-private-integration.mjs");
  const root = await mkdtemp(path.join(tmpdir(), "sm-key-binding-"));
  try {
    const recovery = generateKeyPairSync("rsa", { modulusLength: 3072 }),
      signer = generateKeyPairSync("ed25519");
    const run = randomUUID(),
      id = randomUUID(),
      manifestId = randomUUID();
    const plain = path.join(root, "manifest"),
      manifestArchive = path.join(root, "sealed");
    const payload = JSON.stringify({
      run,
      synthetic: true,
      recoveryKeyId: "wrong",
      signingKeyId: keyId(signer.publicKey),
      files: [],
    });
    await writeFile(
      plain,
      JSON.stringify({
        payload,
        signature: sign(null, Buffer.from(payload), signer.privateKey).toString(
          "base64",
        ),
      }),
    );
    await encryptFile(
      plain,
      manifestArchive,
      recovery.publicKey,
      `${run}/${manifestId}`,
    );
    await assert.rejects(
      verifySyntheticRecovery({
        run,
        id,
        manifestId,
        manifestArchive,
        archive: path.join(root, "must-not-read"),
        restored: path.join(root, "out"),
        privateKey: recovery.privateKey,
        signingPublicKey: signer.publicKey,
      }),
      (e) => e.code === "ERR_ASSERTION",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
