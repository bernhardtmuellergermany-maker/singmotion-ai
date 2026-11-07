// Manual entry point only. No env files, application DB, BytePlus or worker imports.
import { checkR2Connectivity } from "../lib/live/r2-connectivity.ts";
if (process.argv.slice(2).join(" ") !== "--confirm-r2-connectivity-test") {
  console.error(
    "No requests made. To run the isolated R2 probe explicitly: npm run r2:check -- --confirm-r2-connectivity-test",
  );
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const result = await checkR2Connectivity(process.env, {
      signal: controller.signal,
      reportKey: (key) => console.log(`Non-sensitive test object: ${key}`),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error(
      "R2 connectivity check failed unexpectedly. No credentials or signed URLs are included in this diagnostic.",
    );
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
