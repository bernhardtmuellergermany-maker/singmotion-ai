/** Cloud connector controller. Import only; no startup, CLI, credentials or API calls
 * on import. tools is the authenticated Railway connector surface. journal persists
 * non-secret progress in the cloud workspace. Never run without explicit approval.
 */
export const scope = Object.freeze({
  projectId: "96ab3402-f974-4cdf-b9a3-408443b17025",
  environmentId: "36adc41d-7e54-4396-ad1a-fd432ba0441d",
});
export const worker = "4dfb0406-e0a0-48b1-aa6b-0e36cd89190a";
const original = "d36acf6d8f5b268ffef907c53f0524c90d7b852f";
const originalDeployment = "997727b4-ab05-4949-8ec7-63d10d3741c1";
const repo = "bernhardtmuellergermany-maker/singmotion-ai";
const branch = "release/production-promoted-20261114";
export async function runCombinedTest({
  tools,
  approval,
  commit,
  bundle,
  journal,
  now = Date.now,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (
    approval !== "ONE_SYNTHETIC_COMBINED_RUN_WITH_ROLLBACK" ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    typeof journal !== "function"
  )
    throw Error("EXPLICIT_APPROVAL_REQUIRED");
  const started = now(),
    owned = [],
    evidence = { commit, run: bundle.sender.BACKUP_RUN_ID, events: [] };
  let touched = false,
    failure;
  const save = async (event, data = {}) => {
    evidence.events.push({ event, ...data });
    await journal(evidence);
  };
  const call = async (name, args) => {
    const r = await tools[`mcp__codex_apps__railway_${name}`](args);
    if (r.isError || !r.structuredContent)
      throw Error("CONNECTOR_OPERATION_FAILED");
    return r.structuredContent;
  };
  const deadline = () => {
    if (now() - started > 20 * 60 * 1000) throw Error("CONTROLLER_DEADLINE");
  };
  async function baseline() {
    const env = await call("describe_environment", scope);
    if (
      env.staged ||
      env.services.length !== 3 ||
      env.services.some(
        (s) =>
          ![
            "4dfb0406-e0a0-48b1-aa6b-0e36cd89190a",
            "2c6bca77-61e6-4ab5-9447-fa23767622aa",
            "10a10398-e2b8-45bf-a8f5-298999904358",
          ].includes(s.id),
      )
    )
      throw Error("BASELINE_DRIFT");
    const w = await call("describe_service", { ...scope, serviceId: worker });
    if (
      w.config.source.commitSha !== original ||
      w.config.build.dockerfilePath !== "Dockerfile.backup" ||
      w.config.deploy.restartPolicyType !== "NEVER" ||
      w.domains?.serviceDomains.length ||
      w.domains?.customDomains.length ||
      w.tcpProxies?.length ||
      w.volumes.length !== 1 ||
      w.volumes[0].id !== "00e52dae-7be6-45aa-9e2d-898404b2c17e" ||
      w.volumes[0].mountPath !== "/state"
    )
      throw Error("BASELINE_DRIFT");
    return env;
  }
  async function stageSource(serviceId, sha, file, sourceBranch) {
    await call("connect_service_source", {
      ...scope,
      serviceId,
      repo,
      branch: sourceBranch,
      commitSha: sha,
      staged: true,
    });
    await call("update_service", {
      ...scope,
      serviceId,
      dockerfilePath: file,
      staged: true,
    });
  }
  async function accept(allowed) {
    const env = await call("describe_environment", scope);
    if (
      env.services.some(
        (s) => s.stagedChangeCount && !allowed.includes(s.id),
      ) ||
      env.buckets.some((b) => b.stagedChangeCount) ||
      env.volumes.some((v) => v.stagedChangeCount)
    )
      throw Error("UNRELATED_STAGED_CHANGE");
    await call("accept_deploy", {
      environmentId: scope.environmentId,
      commitMessage: "PR278 approved synthetic test / controlled rollback",
    });
  }
  async function waitDeployment(
    serviceId,
    sha,
    marker,
    limit = 180000,
    expectedId = null,
    excludeId = null,
  ) {
    const until = now() + limit;
    while (now() < until) {
      const ds = await call("list_deployments", {
        ...scope,
        serviceId,
        limit: 1,
      });
      const d = ds.deployments[0];
      if (
        d &&
        d.id !== excludeId &&
        (!expectedId || d.id === expectedId) &&
        Date.parse(d.createdAt) >= started
      ) {
        if (sha && d.meta?.commitHash !== sha)
          throw Error("DEPLOYED_COMMIT_MISMATCH");
        if (["FAILED", "CRASHED", "REMOVED"].includes(d.status))
          throw Error("DEPLOYMENT_FAILED");
        const logs = await call("get_logs", {
          projectId: scope.projectId,
          deploymentId: d.id,
          types: ["deploy"],
          limit: 100,
        });
        const messages = (logs.deploy ?? []).map((x) => x.message);
        if (messages.some((x) => /FAILED|DEADLINE_EXCEEDED|^BACKUP_/.test(x)))
          throw Error("RUNTIME_FAILED");
        if (
          d.status === "SUCCESS" &&
          messages.some((x) => x.startsWith(marker))
        ) {
          await save("VERIFIED", { serviceId, deploymentId: d.id, marker });
          return { d, logs };
        }
      }
      await pause(5000);
    }
    throw Error("MARKER_TIMEOUT");
  }
  const before = await baseline();
  await save("BASELINE", {
    services: before.services.map((s) => ({
      id: s.id,
      deploymentId: s.latestDeployment?.id,
    })),
  });
  try {
    for (const role of ["sender", "restore"]) {
      deadline();
      const name = `backup230-hidrive-${role}`;
      await save("CREATE_INTENT", { role, name });
      const created = await call("create_service", { ...scope, name });
      owned.push({ role, id: created.service.id });
      await save("CREATED", { role, serviceId: created.service.id });
      await call("update_service", {
        ...scope,
        serviceId: created.service.id,
        dockerfilePath: "Dockerfile.hidrive-fixture",
        restartPolicyType: "NEVER",
        limits: { vCPUs: 1, memoryGB: 0.5 },
        regions: { sfo: { numReplicas: 1 } },
      });
      await call("set_variables", {
        ...scope,
        serviceId: created.service.id,
        variables: bundle[role],
        skipDeploys: true,
      });
    }
    touched = true;
    await save("RECEIVER_ACTIVATION_INTENT");
    await stageSource(
      worker,
      commit,
      "Dockerfile.hidrive-integration",
      "feat/cloud-backup-230",
    );
    await call("set_variables", {
      ...scope,
      serviceId: worker,
      variables: bundle.receiver,
      staged: true,
    });
    await accept([worker]);
    const ready = await waitDeployment(
      worker,
      commit,
      "HIDRIVE_SYNTHETIC_PRIVATE_RECEIVER_READY",
    );
    if (
      !ready.logs.deploy.some(
        (x) => x.message === "HIDRIVE_RESIDUAL_CHECK_COMPLETED",
      )
    )
      throw Error("RESIDUAL_CHECK_MISSING");
    const residuals = ready.logs.deploy
      .filter((x) => x.message.startsWith("HIDRIVE_RESIDUAL_RESULT "))
      .map((x) =>
        JSON.parse(x.message.slice("HIDRIVE_RESIDUAL_RESULT ".length)),
      );
    if (
      residuals.length !== 3 ||
      residuals.some(
        (x, i) =>
          x.ordinal !== i + 1 || !["absent", "present"].includes(x.state),
      )
    )
      throw Error("RESIDUAL_EVIDENCE_INVALID");
    await save("RESIDUAL_CHECK_COMPLETED", {
      results: residuals.map((x) => ({
        ordinal: x.ordinal,
        state: x.state,
        bytes: x.bytes,
        sha256: x.sha256,
      })),
    });
    deadline();
    // Deploy restore only after sender/remote commit; no polling downloads required.
    const sender = owned.find((x) => x.role === "sender").id;
    await stageSource(
      sender,
      commit,
      "Dockerfile.hidrive-fixture",
      "feat/cloud-backup-230",
    );
    await accept([sender]);
    await waitDeployment(sender, commit, "HIDRIVE_SYNTHETIC_SENDER_COMPLETED");
    await waitDeployment(
      worker,
      commit,
      "HIDRIVE_SYNTHETIC_REMOTE_COMMIT_VERIFIED",
      30000,
    );
    const restore = owned.find((x) => x.role === "restore").id;
    await stageSource(
      restore,
      commit,
      "Dockerfile.hidrive-fixture",
      "feat/cloud-backup-230",
    );
    await accept([restore]);
    const recovered = await waitDeployment(
      restore,
      commit,
      "HIDRIVE_INDEPENDENT_RESTORE_VERIFIED",
    );
    const line = recovered.logs.deploy.find((x) =>
      x.message.startsWith("HIDRIVE_INDEPENDENT_RESTORE_VERIFIED"),
    );
    const result = JSON.parse(
      line.message.slice("HIDRIVE_INDEPENDENT_RESTORE_VERIFIED".length).trim(),
    );
    if (
      result.run !== bundle.sender.BACKUP_RUN_ID ||
      result.restoreServiceId !== restore ||
      ![
        "artificialData",
        "signature",
        "ciphertextSha256",
        "aead",
        "plaintextSha256",
      ].every((k) => result[k] === true)
    )
      throw Error("RESTORE_EVIDENCE_INVALID");
    await save("INTEGRATION_VERIFIED");
  } catch (error) {
    failure = error;
    await save("TEST_FAILED");
  } finally {
    // Cleanup attempts are independent: one failure must not suppress the rest.
    const errors = [];
    const attempt = async (operation) => {
      try {
        await operation();
      } catch {
        errors.push("ROLLBACK_STEP_FAILED");
      }
    };
    await attempt(async () => {
      // Recover a created service whose connector response was lost. Baseline proved
      // these exact names absent; never select by a broad prefix or delete a volume.
      const env = await call("describe_environment", scope);
      for (const s of env.services.filter((s) =>
        ["backup230-hidrive-sender", "backup230-hidrive-restore"].includes(
          s.name,
        ),
      )) {
        if (s.volumeMounts.length) throw Error("UNEXPECTED_VOLUME");
        if (!owned.some((x) => x.id === s.id)) owned.push({ id: s.id });
      }
    });
    for (const s of owned)
      await attempt(() =>
        call("delete_service", { ...scope, serviceId: s.id }),
      );
    if (touched) {
      await attempt(async () => {
        await stageSource(worker, original, "Dockerfile.backup", branch);
        await call("set_variables", {
          ...scope,
          serviceId: worker,
          variables: { BACKUP_MODE: "SETUP_ONLY_NO_DATA_TRANSFER" },
          staged: true,
        });
        const previous = (
          await call("list_deployments", {
            ...scope,
            serviceId: worker,
            limit: 1,
          })
        ).deployments[0]?.id;
        await accept([worker]);
        await waitDeployment(
          worker,
          null,
          "HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER",
          180000,
          null,
          previous,
        );
        // Source pin alone was not honored by the previous build. Always reuse exact
        // original build, after variable/config restoration has been committed.
        const restored = await call("redeploy", {
          ...scope,
          serviceId: worker,
          deploymentId: originalDeployment,
        });
        await waitDeployment(
          worker,
          original,
          "HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER",
          180000,
          restored.deployment.id,
        );
      });
    }
    await attempt(async () => {
      const after = await baseline();
      for (const s of before.services.filter((x) => x.id !== worker))
        if (
          after.services.find((x) => x.id === s.id)?.latestDeployment?.id !==
          s.latestDeployment?.id
        )
          throw Error("UNRELATED_DEPLOYMENT_CHANGED");
    });
    await save(errors.length ? "ROLLBACK_INCOMPLETE" : "ROLLBACK_VERIFIED");
    if (errors.length)
      throw Error("ROLLBACK_INCOMPLETE_OPERATOR_RECOVERY_REQUIRED");
  }
  if (failure) throw Error("COMBINED_TEST_FAILED_ROLLBACK_VERIFIED");
  return evidence;
}
