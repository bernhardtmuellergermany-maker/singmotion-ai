// Read-only operator audit for live BytePlus attempts. No app routes or external calls.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { existsSync } from "node:fs";

const root = process.env.DATA_DIR;
if (!root || !path.isAbsolute(root)) {
  console.error("Set DATA_DIR to the existing absolute Railway volume path.");
  process.exit(1);
}
const filename = path.join(root, "live-test.sqlite");
if (!existsSync(filename)) {
  console.error("Existing live-test.sqlite not found; refusing to create a database.");
  process.exit(1);
}
const db = new DatabaseSync(filename, { readOnly: true });
try {
  const rows = db.prepare("SELECT data FROM live_attempts ORDER BY rowid").all();
  const attempts = rows.map((row) => {
    const a = JSON.parse(String(row.data));
    return {
      taskId: a.providerJobId ?? null,
      state: String(a.state ?? "unknown"),
      inputSeconds: Number.isFinite(a.media?.durationSeconds) ? a.media.durationSeconds : null,
      createdDateUTC: Number.isFinite(a.createdAt) ? new Date(a.createdAt).toISOString().slice(0, 10) : null,
      hasValidatedOutput: a.state === "completed" && Boolean(a.outputPath),
    };
  });
  const october = attempts.filter((a) => a.createdDateUTC?.startsWith("2026-10"));
  const knownInputSeconds = october.reduce((total, a) => total + (a.inputSeconds ?? 0), 0);
  console.log(JSON.stringify({
    scope: "Existing Railway live-test.sqlite, records created in October 2026 UTC",
    caution: "Input duration is NOT provider-billed output duration; provider invoice remains authoritative.",
    totalAttempts: attempts.length,
    octoberAttempts: october,
    octoberKnownInputSeconds: Number(knownInputSeconds.toFixed(3)),
    billedSecondsFromProvidedBytePlusInvoice: 100,
    billingMatchesInputSeconds: "Not a valid comparison: BytePlus bills generated output seconds.",
  }, null, 2));
} finally {
  db.close();
}
