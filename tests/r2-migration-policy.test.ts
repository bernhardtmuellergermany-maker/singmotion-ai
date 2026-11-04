import {test} from "node:test";
import assert from "node:assert/strict";
import {allowPrivateMediaMigration} from "../scripts/migrate-test-assets-to-r2.ts";
const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
test("never migrate production test data from a staging-only approval",()=>{
 const env={RAILWAY_ENVIRONMENT_ID:PRODUCTION,
  CUSTOMER_R2_STORAGE_ENABLED:"true",R2_MIGRATE_TEST_DATA:"true"};
 assert.equal(allowPrivateMediaMigration(env),false);
 assert.equal(allowPrivateMediaMigration({...env,PRODUCTION_R2_MIGRATION_APPROVED:"true"}),false);
 assert.equal(allowPrivateMediaMigration({...env,CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:"true"}),false);
 assert.equal(allowPrivateMediaMigration({...env,CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:"true",PRODUCTION_R2_MIGRATION_APPROVED:"true"}),true);
});
test("staging migration is explicitly opt-in and never runs in unknown environments",()=>{
 assert.equal(allowPrivateMediaMigration({RAILWAY_ENVIRONMENT_ID:STAGING,CUSTOMER_R2_STORAGE_ENABLED:"true"}),false);
 assert.equal(allowPrivateMediaMigration({RAILWAY_ENVIRONMENT_ID:STAGING,CUSTOMER_R2_STORAGE_ENABLED:"true",R2_MIGRATE_TEST_DATA:"true"}),true);
 assert.equal(allowPrivateMediaMigration({RAILWAY_ENVIRONMENT_ID:"unexpected",CUSTOMER_R2_STORAGE_ENABLED:"true",R2_MIGRATE_TEST_DATA:"true",PRODUCTION_R2_MIGRATION_APPROVED:"true",CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:"true"}),false);
});
