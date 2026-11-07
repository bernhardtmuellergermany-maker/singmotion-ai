import type { S3ClientConfig } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
export function loadR2Config(
  env: Record<string, string | undefined> = process.env,
): R2Config {
  if (typeof window !== "undefined")
    throw new Error("R2 credentials are server-only.");
  const {
    R2_ACCOUNT_ID: accountId,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (
    !accountId ||
    !/^[a-f0-9]{32}$/.test(accountId) ||
    !bucket ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    !accessKeyId ||
    !/^[A-Za-z0-9_-]+$/.test(accessKeyId) ||
    !secretAccessKey ||
    /[\r\n]/.test(secretAccessKey)
  )
    throw new Error("R2 server configuration is missing or invalid.");
  return { accountId, bucket, accessKeyId, secretAccessKey };
}
export function r2ClientConfig(config: R2Config): S3ClientConfig {
  return {
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
    maxAttempts: 1,
    followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 5000, requestTimeout: 60000 },
  };
}
