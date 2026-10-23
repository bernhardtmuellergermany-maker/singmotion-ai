import { hiddenPrompt } from "./hidden-prompt.ts";

async function main() {
  if (
    process.argv.length !== 2 ||
    process.env.CMS_ENABLED !== "true" ||
    process.env.CMS_RECOVERY_ENABLED !== "true"
  )
    throw new Error("Recovery gate closed.");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Interactive terminal required.");
  // These are server configuration only; no provider adapters or public endpoints.
  const { default: configuration } = await import("../payload.config.ts");
  const { getPayload } = await import("payload");
  const { recoverAdmin, recoveryConfirmation, validateRecovery } =
    await import("../cms/recover-admin.ts");
  const config = await configuration;
  // Do not let database/validation exceptions log submitted data. The CLI emits fixed diagnostics only.
  const { default: pino } = await import("pino");
  // SanitizedConfig deeply requires optional Pino members; the supported logger is a Pino instance.
  config.logger = pino({ level: "silent" }) as typeof config.logger;
  const payload = await getPayload({ config });
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
  // Never print exceptions, stacks, arguments or connection details. A lost database
  // acknowledgement can mean a committed update: operator must check login first.
  console.error(
    "Recovery stopped. Check the interactive terminal, recovery gate, confirmation, matching 20–1024 character passwords, existing super-admin and database availability. If interrupted during the update, check login before retrying. No account was created.",
  );
  process.exit(1);
}
