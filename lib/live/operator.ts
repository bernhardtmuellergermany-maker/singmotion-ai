import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import {
  assertBytePlusVerified,
  contractDigest,
  planUpperBoundMicroUsd,
  type VerifiedContract,
} from "./contract.ts";
import {
  authorizeOperator,
  enforceCap,
  type LiveTestConfig,
} from "./config.ts";
import { revalidateMedia } from "./media.ts";
import { inputDeliveryPolicy } from "./input-policy.ts";
import { LiveTestStore } from "./store.ts";
import { LiveTestRunner, type ReviewedProvider } from "./runner.ts";
import type { downloadValidatedOutput } from "./output.ts";

/** Trusted dependencies only; never populated from env, CLI JSON or browser data.
 * Production verification defaults to the hard block. Tests inject fictional
 * evidence/providers; this class does not construct a network transport.
 */
interface OperatorDependencies {
  recoverableOutput?: boolean;
  verifiedContract?: () => VerifiedContract;
  provider?: ReviewedProvider;
  download?: typeof downloadValidatedOutput;
  cleanupInputs?: (id: string, signal: AbortSignal) => Promise<void>;
}
export class OperatorWorkflow {
  readonly store: LiveTestStore;
  readonly config: LiveTestConfig;
  readonly dataDir: string;
  private readonly dependencies: OperatorDependencies;
  constructor(
    store: LiveTestStore,
    config: LiveTestConfig,
    dataDir: string,
    dependencies: OperatorDependencies = {},
  ) {
    this.store = store;
    this.config = config;
    this.dataDir = dataDir;
    this.dependencies = dependencies;
  }
  review(id: string, owner: string) {
    const attempt = this.store.get(id);
    if (attempt.media.owner !== owner) throw new Error("Owned plan not found.");
    return attempt;
  }
  private contract() {
    const contract = (
      this.dependencies.verifiedContract ?? assertBytePlusVerified
    )();
    if (
      !contract.revision ||
      !contract.documentationUrl ||
      contract.model !== "OmniHuman 2.0" ||
      !contract.promptSupported ||
      !Number.isSafeInteger(contract.inputFetchWindowSeconds) ||
      contract.inputFetchWindowSeconds! <
        inputDeliveryPolicy.minimumRemainingSeconds ||
      !contract.outputHosts.length ||
      !Number.isSafeInteger(contract.output.width) ||
      contract.output.width <= 0 ||
      !Number.isSafeInteger(contract.output.height) ||
      contract.output.height <= 0 ||
      !Number.isFinite(contract.output.fps) ||
      contract.output.fps <= 0
    )
      throw new Error("Reviewed contract is incomplete.");
    return contract;
  }
  private async validateOwnedMedia(id: string, owner: string) {
    const attempt = this.review(id, owner);
    const root = await realpath(path.join(this.dataDir, "media"));
    for (const file of [attempt.media.audioPath, attempt.media.imagePath])
      if (!(await realpath(file)).startsWith(root + path.sep))
        throw new Error("Snapshots must remain in private media storage.");
    await revalidateMedia(attempt.media);
    return attempt;
  }
  async price(id: string, owner: string) {
    this.review(id, owner);
    const contract = this.contract(); // Fail before expensive work or any write.
    const attempt = await this.validateOwnedMedia(id, owner);
    if (attempt.media.durationSeconds > contract.maxDurationSeconds)
      throw new Error("Contract duration exceeded.");
    const cost = planUpperBoundMicroUsd(
      attempt.media.durationSeconds,
      contract,
    );
    enforceCap(this.config, attempt.media.durationSeconds, cost);
    return this.store.pricePrepared(id, owner, attempt.media, contract);
  }
  private binding(id: string, owner: string) {
    const attempt = this.review(id, owner),
      contract = this.contract();
    if (
      attempt.contractDigest !== contractDigest(contract) ||
      attempt.contractRevision !== contract.revision ||
      attempt.upperBoundMicroUsd !==
        planUpperBoundMicroUsd(attempt.media.durationSeconds, contract)
    )
      throw new Error("Plan does not match the full reviewed contract.");
    return contract;
  }
  async approve(id: string, owner: string, secret: string, phrase: string) {
    this.binding(id, owner);
    await this.validateOwnedMedia(id, owner);
    return this.store.authorize(id, this.config, secret, phrase);
  }
  private async runner(id: string, owner: string, secret: string) {
    const contract = this.binding(id, owner);
    authorizeOperator(this.config, secret);
    const provider = this.dependencies.provider;
    if (
      !provider ||
      contractDigest(provider.contract) !== contractDigest(contract)
    )
      throw new Error("No matching reviewed provider is wired.");
    const root = await realpath(this.dataDir);
    const output = path.join(root, "live-output");
    await mkdir(output, { recursive: true, mode: 0o700 });
    if ((await realpath(output)) !== output)
      throw new Error("Private output directory must not be redirected.");
    return new LiveTestRunner(
      this.store,
      provider,
      this.config,
      output,
      this.dependencies.download,
      this.dependencies.recoverableOutput,
    );
  }
  async submit(id: string, owner: string, token: string, secret: string) {
    await this.validateOwnedMedia(id, owner);
    return (await this.runner(id, owner, secret)).submitOnce(id, token);
  }
  async poll(id: string, owner: string, secret: string) {
    return (await this.runner(id, owner, secret)).pollOnce(id);
  }
  async cancel(id: string, owner: string, secret: string) {
    return (await this.runner(id, owner, secret)).cancelOnce(id);
  }
  async cleanup(
    id: string,
    owner: string,
    secret: string,
    signal: AbortSignal,
  ) {
    this.binding(id, owner);
    authorizeOperator(this.config, secret);
    if (!this.dependencies.cleanupInputs)
      throw new Error("Private cleanup is not wired.");
    await this.dependencies.cleanupInputs(id, signal); // Adapter enforces expiry + grace and exact keys.
  }
}
