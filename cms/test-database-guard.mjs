/** Fail-closed preflight for DESTRUCTIVE Payload CMS integration tests.
 * Only an explicit local disposable PostgreSQL database may be migrated or cleaned.
 * This module has no database imports, side effects or network access. */
export function assertDisposableCmsTestDatabase(env) {
 if (env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT_ID ||
     env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID)
  throw new Error("CMS integration tests are forbidden on deployed infrastructure");
 const connection=env.CMS_TEST_DATABASE_URL;
 if(typeof connection!=="string" || connection.length>4096)
  throw new Error("A disposable local CMS test database is required");
 let url;
 try { url=new URL(connection); }
 catch { throw new Error("Invalid CMS test database URL"); }
 if(!["postgres:","postgresql:"].includes(url.protocol) ||
    !["localhost","127.0.0.1"].includes(url.hostname) ||
    !/^\/[a-z][a-z0-9_]*_test$/.test(url.pathname) ||
    url.search || url.hash ||
    !url.username || !url.password)
  throw new Error("CMS integration requires a local disposable *_test PostgreSQL database without URL overrides");
 // Do not permit the same physical connection string to be reused for app/CMS data.
 if([env.CMS_DATABASE_URL,env.DATABASE_URL].some(value=>value && value===connection))
  throw new Error("CMS test database must not reuse an application database connection");
 return connection;
}

/** Starting a disposable local cluster is never permitted when the caller has
 * an existing database configuration or runs in a Railway/production context.
 * The launcher also excludes inherited credentials from its child processes. */
export function assertSafeCmsLocalTestRunner(env) {
 if(env.NODE_ENV==="production" || env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID)
  throw Error("Local CMS runner cannot start on Railway or production");
 if(env.CMS_DATABASE_URL || env.DATABASE_URL || env.CMS_TEST_DATABASE_URL)
  throw Error("Local CMS runner refuses existing database settings");
 return true;
}
