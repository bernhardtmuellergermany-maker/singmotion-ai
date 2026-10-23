import { createHash, timingSafeEqual } from "node:crypto";

type Environment = Record<string, string | undefined>;
export function stagingEnabled(env: Environment = process.env) {
  // Railway cannot accidentally disable its access gate.
  return (
    Boolean(env.RAILWAY_ENVIRONMENT_ID) ||
    env.STAGING_AUTH_ENABLED === "true" ||
    (env.NODE_ENV === "production" && env.STAGING_AUTH_ENABLED !== "false")
  );
}
export function validateStaging(env: Environment = process.env) {
  if (!stagingEnabled(env)) return;
  if (!env.STAGING_PASSWORD || env.STAGING_PASSWORD.length < 32)
    throw new Error(
      "Set STAGING_PASSWORD to a random secret of at least 32 characters.",
    );
  if (
    env.DEMO_MODE !== "true" ||
    env.GENERATIONS_ENABLED !== "false" ||
    env.ADMIN_DEMO_ENABLED !== "false" ||
    env.BYTEPLUS_LIVE_TEST_ENABLED === "true"
  )
    throw new Error(
      "Staging requires DEMO_MODE=true, GENERATIONS_ENABLED=false, ADMIN_DEMO_ENABLED=false and BYTEPLUS_LIVE_TEST_ENABLED=false.",
    );
}
export function stagingAccess(
  authorization: string | null,
  env: Environment = process.env,
): 200 | 401 | 503 {
  if (!stagingEnabled(env)) return 200;
  try {
    validateStaging(env);
  } catch {
    return 503;
  }
  if (
    !authorization ||
    authorization.length > 4096 ||
    !/^Basic [A-Za-z0-9+/]+=*$/i.test(authorization)
  )
    return 401;
  const received = Buffer.from(authorization.slice(6), "base64").toString(
    "utf8",
  );
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(
    digest(received),
    digest(`staging:${env.STAGING_PASSWORD}`),
  )
    ? 200
    : 401;
}
export function stagingDenial(
  authorization: string | null,
): Response | undefined {
  const status = stagingAccess(authorization);
  if (status === 200) return;
  return new Response(
    status === 401
      ? "Staging authentication required."
      : "Staging configuration unavailable.",
    {
      status,
      headers: {
        "WWW-Authenticate": 'Basic realm="SingMotion staging", charset="UTF-8"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}
