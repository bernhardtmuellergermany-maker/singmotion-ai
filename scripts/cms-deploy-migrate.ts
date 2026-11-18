// Railway pre-deploy migration runner.
// Unlike the interactive Payload CLI, this program explicitly disposes of
// its PostgreSQL pool and exits after the adapter confirms migration success.
// Do not turn migration errors or database timeouts into successful deploys.
import {getPayload} from "payload";
import config from "../payload.config.ts";

if (!process.env.RAILWAY_SERVICE_ID || !process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.CMS_ENABLED !== "true" || !process.env.CMS_DATABASE_URL) {
  throw new Error("CMS deploy migration requires a configured Railway CMS service.");
}

const payload=await getPayload({config});
try {
  if(typeof payload.db.migrate !== "function"){
    throw new Error("CMS adapter does not expose the migration operation.");
  }
  await payload.db.migrate();
} finally {
  await payload.destroy();
}

// The migration promise and pool cleanup both completed successfully.
// Explicit exit prevents unrelated long-lived Payload/Next.js handles from
// exhausting Railway's bounded pre-deploy command timeout.
console.log("CMS deploy migrations completed and database connections closed.");
process.exit(0);
