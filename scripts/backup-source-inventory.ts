/** Execute inside the existing app container via authenticated Railway SSH.
 * No public listener, no export/upload, no migration, no provider/payment calls.
 * Prints aggregate counts only. Never print caught errors or environment values.
 */
import {
  InventoryError,
  inventoryLocalSources,
  inventoryPostgres,
  inventoryR2,
} from "../lib/ops/backup-source-inventory.ts";
async function main() {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--read-only-no-transfer" ||
    process.env.RAILWAY_SERVICE_NAME !== "singmotion-ai" ||
    process.getuid?.() === 0 ||
    !process.env.DATA_DIR ||
    !process.env.CMS_DATABASE_URL
  )
    throw new InventoryError("PRIVATE_APP_RUNTIME_REQUIRED");
  const startedAt = new Date().toISOString();
  const local = await inventoryLocalSources(process.env.DATA_DIR);
  const { Client } = await import("pg");
  const pg = new Client({
    connectionString: process.env.CMS_DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  let postgres;
  try {
    await pg.connect();
    postgres = await inventoryPostgres((sql) => pg.query(sql));
  } finally {
    await pg.end();
  }
  const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const account = process.env.R2_ACCOUNT_ID,
    bucket = process.env.R2_BUCKET;
  if (
    !account ||
    !/^[a-f0-9]{32}$/i.test(account) ||
    !bucket ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  )
    throw new InventoryError("R2_SOURCE_CONFIGURATION_REQUIRED");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    maxAttempts: 2,
  });
  let r2;
  try {
    const list = (ContinuationToken?: string) =>
      s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 1000,
          ContinuationToken,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    const first = await inventoryR2(list),
      second = await inventoryR2(list);
    if (first.metadataSha256 !== second.metadataSha256)
      throw new InventoryError("R2_CHANGED_DURING_DISCOVERY");
    r2 = { ...second, twoPassStable: true };
  } finally {
    s3.destroy();
  }
  console.log(
    "BACKUP_SOURCE_INVENTORY",
    JSON.stringify({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      local,
      postgres,
      r2,
      backupVerified: false,
      restoreVerified: false,
    }),
  );
}
main().catch((error) => {
  console.error(
    "BACKUP_SOURCE_INVENTORY",
    JSON.stringify({
      ok: false,
      code:
        error instanceof InventoryError
          ? error.message
          : "SOURCE_DISCOVERY_FAILED",
      backupVerified: false,
      restoreVerified: false,
    }),
  );
  process.exitCode = 1;
});
