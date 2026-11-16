import { runHiDriveIntegration } from "./hidrive-private-integration.mjs";
runHiDriveIntegration().catch(() => {
  console.error("HIDRIVE_SYNTHETIC_INTEGRATION_FAILED");
  process.exitCode = 1;
});
