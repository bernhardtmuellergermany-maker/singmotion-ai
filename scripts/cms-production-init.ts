/**
 * One-time, fail-closed Production CMS initialization.
 * Never migrates a database with existing non-CMS tables or partial CMS state.
 * Runs as a pre-deploy command with no public endpoint or secret output.
 */
import { getPayload } from "payload";
import type { PostgresAdapter } from "@payloadcms/db-postgres";
import { sql } from "@payloadcms/db-postgres";
import config from "../payload.config.ts";
const env = process.env;
if (env.RAILWAY_ENVIRONMENT_ID !== "36adc41d-7e54-4396-ad1a-fd432ba0441d" ||
    env.CMS_ENABLED !== "true" ||
    env.CMS_PRODUCTION_SCHEMA_INIT_ENABLED !== "true" ||
    env.STAGING_AUTH_ENABLED !== "true" ||
    env.PRODUCTION_PUBLIC_ACCESS_ENABLED !== "false" ||
    !env.CMS_DATABASE_URL) {
  throw new Error("Protected Production CMS schema init gate is closed.");
}
const payload = await getPayload({ config });
try {
  const id = await payload.db.beginTransaction();
  if (!id) throw new Error("Schema preflight requires a database transaction.");
  let names: string[] = [];
  try {
    const adapter = payload.db as unknown as PostgresAdapter;
    const session = adapter.sessions[id];
    const query = await session.db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name
    `);
    const rows = (Array.isArray(query) ? query : (query as { rows?: unknown[] }).rows || []) as {table_name:string}[];
    names = rows.map(r=>r.table_name);
  } finally {
    await payload.db.rollbackTransaction(id);
  }
  if (names.includes("staff") && names.includes("payload_migrations")) {
    console.log("CMS_SCHEMA_PRESENT: no migration attempted.");
  } else if (names.length !== 0) {
    throw new Error("CMS_SCHEMA_PARTIAL_OR_DATABASE_NOT_EMPTY: refusing automatic migration.");
  } else {
    await payload.db.migrate();
    await payload.count({collection:"staff",overrideAccess:true});
    console.log("CMS_SCHEMA_INITIALIZED: migrations applied to previously empty Production database.");
  }
} finally {
  await payload.destroy();
}
