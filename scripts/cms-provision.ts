// Offline/server-only bootstrap. No public registration; does not log credentials.
import { getPayload } from "payload";
import type { PostgresAdapter } from "@payloadcms/db-postgres";
import config from "../payload.config.ts";
if (
  process.env.CMS_ENABLED !== "true" ||
  process.env.CMS_PROVISION_CONFIRM !== "create-first-super-admin"
)
  throw new Error("Explicit CMS provisioning confirmation required.");
const email = process.env.CMS_INITIAL_ADMIN_EMAIL;
const password = process.env.CMS_INITIAL_ADMIN_PASSWORD;
if (!email || !password || password.length < 20)
  throw new Error(
    "Provide initial administrator email and a unique password of at least 20 characters through server environment variables.",
  );
const payload = await getPayload({ config });
try {
  // Transaction + advisory lock prevents two concurrent bootstrap commands.
  const transactionID = await payload.db.beginTransaction();
  if (!transactionID)
    throw new Error("A provisioning transaction is required.");
  try {
    const session = (payload.db as unknown as PostgresAdapter).sessions[
      transactionID
    ];
    const { sql } = await import("@payloadcms/db-postgres");
    await session.db.execute(sql`SELECT pg_advisory_xact_lock(73158012)`);
    const req = { transactionID, context: { provisioning: true } };
    if (
      (await payload.count({ collection: "staff", overrideAccess: true, req }))
        .totalDocs
    )
      throw new Error("Staff already exists; initial provisioning refused.");
    await payload.create({
      collection: "staff",
      overrideAccess: true,
      req,
      data: { email, password, role: "super-admin" },
    });
    await payload.db.commitTransaction(transactionID);
    console.log(
      "Initial super administrator created. Remove bootstrap variables now.",
    );
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID);
    throw error;
  }
} finally {
  await payload.destroy();
}

process.exit(0);
