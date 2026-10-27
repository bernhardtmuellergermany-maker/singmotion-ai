import { type MigrateUpArgs, sql } from "@payloadcms/db-postgres";

/** Additive only. No legacy table, project, reservation or media is changed. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "studio_settings" (
      "id" serial PRIMARY KEY NOT NULL,
      "intro" varchar,
      "performance_templates" jsonb,
      "camera_templates" jsonb,
      "updated_at" timestamp(3) with time zone,
      "created_at" timestamp(3) with time zone
    );
  `);
}
export async function down(): Promise<void> {
  throw new Error(
    "Non-destructive rollback: retain studio_settings and roll back application code only.",
  );
}
