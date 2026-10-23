import { assertBytePlusVerified } from "../lib/live/contract.ts";
// No public HTTP endpoint or environment switch may bypass this gate. The real
// transport must only be wired after its exact 2.0 contract and billing are reviewed.
try {
  assertBytePlusVerified();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Live test is disabled.",
  );
  process.exitCode = 1;
}
