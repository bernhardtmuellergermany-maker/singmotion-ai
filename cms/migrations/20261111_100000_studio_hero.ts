import { type MigrateUpArgs, sql } from "@payloadcms/db-postgres";

/** Add optional CMS copy and image selection. No existing media or projects are changed. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "studio_settings"
      ADD COLUMN IF NOT EXISTS "hero_heading" varchar,
      ADD COLUMN IF NOT EXISTS "hero_subtitle" varchar,
      ADD COLUMN IF NOT EXISTS "hero_image_id" integer,
      ADD COLUMN IF NOT EXISTS "audio_ready_headline" varchar,
      ADD COLUMN IF NOT EXISTS "audio_ready_subtitle" varchar;
    CREATE INDEX IF NOT EXISTS "studio_settings_hero_image_idx"
      ON "studio_settings" USING btree ("hero_image_id");
  `);
}
export async function down(): Promise<void> {
  throw new Error("Non-destructive rollback: keep optional Studio CMS fields.");
}
