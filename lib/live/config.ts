import type { EuroBudget } from "./studio-budget.ts";
import { createHash, timingSafeEqual } from "node:crypto";
export interface LiveTestConfig {
  eurBudget?: EuroBudget;
  demoMode: boolean;
  enabled: boolean;
  operatorSecret: string;
  maxJobMicroUsd: number;
  maxTotalMicroUsd: number;
  maxDurationSeconds: number;
}
export function liveTestConfig(
  env: Record<string, string | undefined> = process.env,
): LiveTestConfig {
  function integer(name: string, fallback: number) {
    const value =
      env[name] === undefined || env[name] === ""
        ? fallback
        : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`Invalid ${name}.`);
    return value;
  }
  return {
    demoMode: env.DEMO_MODE !== "false",
    enabled: env.BYTEPLUS_LIVE_TEST_ENABLED === "true",
    operatorSecret: env.BYTEPLUS_LIVE_TEST_OPERATOR_SECRET || "",
    maxJobMicroUsd: integer("BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD", 0),
    maxTotalMicroUsd: integer("BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD", 0),
    maxDurationSeconds: integer("BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS", 10),
  };
}
export function authorizeOperator(config: LiveTestConfig, provided: string) {
  if (config.demoMode || !config.enabled)
    throw new Error(
      "Paid tests are disabled while DEMO_MODE is enabled or live testing is off.",
    );
  if (config.operatorSecret.length < 32 || !provided)
    throw new Error(
      "A server-side operator secret of at least 32 characters is required.",
    );
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(digest(config.operatorSecret), digest(provided)))
    throw new Error("Operator authorization denied.");
}
export function enforceCap(
  config: LiveTestConfig,
  duration: number,
  upperBound: number | null,
) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    config.maxDurationSeconds < 1 ||
    duration > Math.min(config.maxDurationSeconds, 300)
  )
    throw new Error("The clip exceeds the live-test duration limit.");
  if (
    upperBound === null ||
    !Number.isSafeInteger(upperBound) ||
    upperBound <= 0
  )
    throw new Error(
      "A verified inclusive cost upper bound is required; unknown billing cannot be approved.",
    );
  if (
    config.maxJobMicroUsd <= 0 ||
    config.maxTotalMicroUsd <= 0 ||
    upperBound > config.maxJobMicroUsd
  )
    throw new Error("Live-test spending cap exceeded or unset.");
}
