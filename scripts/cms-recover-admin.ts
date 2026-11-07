import { hiddenPrompt } from "./hidden-prompt.ts";

let phase = "preflight";
async function main() {
  // tsx/npm may change process.argv shape. Never take passwords from argv.
  // Only an explicitly enabled recovery gate and an interactive TTY are required.
  if (process.env.CMS_ENABLED !== "true") {
    phase = "cms-disabled";
    throw new Error("Recovery gate closed.");
  }
  if (process.env.CMS_RECOVERY_ENABLED !== "true") {
    phase = "recovery-disabled";
    throw new Error("Recovery gate closed.");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    phase = "terminal-not-interactive";
    throw new Error("Interactive terminal required.");
  }
  // These are server configuration only; no provider adapters or public endpoints.
  phase = "cms-init";
  const { default: configuration } = await import("../payload.config.ts");
  const { getPayload } = await import("payload");
  const { recoverAdmin, recoveryConfirmation, validateRecovery } =
    await import("../cms/recover-admin.ts");
  // Use the same CMS initialization as the independently verified connection check.
  const payload = await getPayload({ config: await configuration });
  phase = "interactive-input";
  let password = "",
    repeat = "";
  try {
    console.log(
      "Server-only recovery: resets one existing super-admin password, revokes its sessions and unlocks its login. No account is created.",
    );
    const email = await hiddenPrompt("Existing super-admin email (hidden): ");
    const confirmation = await hiddenPrompt(
      `Type ${recoveryConfirmation} to authorize recovery (hidden): `,
    );
    if (confirmation !== recoveryConfirmation)
      throw new Error("Confirmation refused.");
    password = await hiddenPrompt(
      "New password, 20–1024 characters (hidden): ",
    );
    repeat = await hiddenPrompt("Repeat new password (hidden): ");
    if (password !== repeat) throw new Error("Passwords do not match.");
    validateRecovery(password, confirmation);
    phase = "account-recovery";
    await recoverAdmin(payload, email, password, confirmation);
    console.log(
      "Recovery committed. Existing account preserved; previous sessions revoked and login unlocked. Sign in with the new password.",
    );
  } finally {
    password = "";
    repeat = "";
    await payload.destroy();
  }
}
try {
  await main();
  process.exit(0);
} catch {
  console.error(`Recovery phase: ${phase}`);
  // Never print exceptions, stacks, arguments or connection details. A lost database
  // acknowledgement can mean a committed update: operator must check login first.
  console.error(
    "Recovery stopped. Check the interactive terminal, recovery gate, confirmation, matching 20–1024 character passwords, existing super-admin and database availability. If interrupted during the update, check login before retrying. No account was created.",
  );
  process.exit(1);
}
