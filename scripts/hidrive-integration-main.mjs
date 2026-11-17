import { runHiDriveIntegration } from "./hidrive-private-integration.mjs";
import { diagnostic } from "../lib/ops/backup-errors.mjs";
runHiDriveIntegration().catch((error) => {
  console.error(
    diagnostic(
      process.env.BACKUP_INTEGRATION_ROLE === "restore"
        ? "RESTORE"
        : "INTEGRATION",
      error,
    ),
  );
  console.error("HIDRIVE_SYNTHETIC_INTEGRATION_FAILED");
  process.exitCode = 1;
});
