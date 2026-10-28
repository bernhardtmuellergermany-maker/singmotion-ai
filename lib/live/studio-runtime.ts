import { PollError } from "./poll-error.ts";
import { recoveryHealth } from "./studio-activation.ts";
/** Explicit pilot construction only; importing this module opens no DB or network. */
import { stat } from "node:fs/promises";
import path from "node:path";
import { StudioLiveError } from "./studio-policy.ts";
import { BytePlusProtocol, DocumentedBytePlusProvider } from "./byteplus.ts";
import { createSignedTransport } from "./signed-transport.ts";
import { loadBytePlusCredentials } from "./signing.ts";
import { R2PrivateInputDelivery, loadR2Config } from "./r2.ts";
import { StudioWorkflow } from "./studio.ts";
import { loadStudioPolicy, studioConfig } from "./studio-policy.ts";
import type { LiveTestStore } from "./store.ts";
export async function studioReadiness(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    loadR2Config(env);
    loadBytePlusCredentials(env);
  } catch {
    throw new StudioLiveError(
      "PROVIDER_CONFIG_REQUIRED",
      "Valid server-side BytePlus and R2 configuration is required.",
      503,
    );
  }
  if (env.BYTEPLUS_STUDIO_RECOVERY_ENABLED !== "true")
    throw new StudioLiveError(
      "RECOVERY_DISABLED",
      "Enable the recovery-only Studio worker before allowing a paid submission.",
      503,
    );
  const heartbeat = await stat(path.join(root, "worker-heartbeat")).catch(
    () => null,
  );
  if (
    !heartbeat ||
    Date.now() - heartbeat.mtimeMs > 180000 ||
    !(await recoveryHealth(root)).healthy
  )
    throw new StudioLiveError(
      "WORKER_OFFLINE",
      "The recovery worker is offline. No paid task was submitted.",
      503,
    );
}
export function studioRuntime(
  store: LiveTestStore,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  superAdmin = false,
) {
  const resources: R2PrivateInputDelivery[] = [];
  const service = new StudioWorkflow(store, root, studioConfig(env), {
    policy: () => loadStudioPolicy(root, !superAdmin),
    ready: () => studioReadiness(root, env),
    provider: (policy) => {
      const delivery = new R2PrivateInputDelivery(
        store,
        root,
        loadR2Config(env),
      );
      resources.push(delivery);
      const protocol = new BytePlusProtocol(
        createSignedTransport(fetch, () => loadBytePlusCredentials(env)),
      );
      const provider = new DocumentedBytePlusProvider(
        policy.contract,
        delivery,
        delivery.inputHosts,
        protocol,
      );
      // HTTP/provider errors are failed READS, not proof that the task failed/free.
      return {
        contract: policy.contract,
        submit: provider.submit.bind(provider),
        poll: async (id, signal) => {
          const result = await protocol.status(id, signal);
          if (result.status === "done")
            return { state: "completed" as const, outputUrl: result.outputUrl };
          if (result.status === "in_queue" || result.status === "generating")
            return { state: "pending" as const };
          if (result.status === "canceled") return { state: "failed" as const };
          // Missing/expired status records are not proof of the task's final outcome.
          throw new PollError("TASK_OUTCOME_UNVERIFIED");
        },
      };
    },
  }, superAdmin);
  return {
    service,
    close: () => {
      for (const resource of resources) resource.client.destroy();
      store.close();
    },
  };
}
