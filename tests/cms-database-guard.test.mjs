import {test} from "node:test";
import assert from "node:assert/strict";
import {assertDisposableCmsTestDatabase} from "../cms/test-database-guard.mjs";

const local="postgresql://cms_test_user:local_only@127.0.0.1:5432/singmotion_cms_test";
test("CMS migration preflight only permits explicitly isolated local *_test database",()=>{
 assert.equal(assertDisposableCmsTestDatabase({CMS_TEST_DATABASE_URL:local}),local);
 assert.equal(assertDisposableCmsTestDatabase({
  CMS_TEST_DATABASE_URL:"postgres://cms_test_user:local_only@localhost:5432/demo_test"
 }),"postgres://cms_test_user:local_only@localhost:5432/demo_test");
});
test("CMS migration preflight refuses Railway, production, live database reuse, DNS and Unix sockets",()=>{
 const changes=[
  {RAILWAY_ENVIRONMENT_ID:"staging"},
  {RAILWAY_PROJECT_ID:"project"},
  {RAILWAY_SERVICE_ID:"service"},
  {NODE_ENV:"production"},
  {CMS_DATABASE_URL:local},
  {DATABASE_URL:local},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@production.example.com/demo_test"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@10.0.0.1/demo_test"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@localhost/singmotion_cms"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@localhost/_test"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@localhost/demo_test?host=production.example.com"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@localhost/demo_test?host=/var/run/postgresql"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@localhost/demo_test?sslmode=require"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@localhost/demo_test#remote"},
  {CMS_TEST_DATABASE_URL:"https://u:p@localhost/demo_test"},
  {CMS_TEST_DATABASE_URL:"postgres://localhost/demo_test"},
  {CMS_TEST_DATABASE_URL:"postgres://u:p@localhost/demo%5ftest"},
  {CMS_TEST_DATABASE_URL:"not-a-url"},
  {CMS_TEST_DATABASE_URL:undefined},
 ];
 for(const override of changes)
  assert.throws(()=>assertDisposableCmsTestDatabase({
   CMS_TEST_DATABASE_URL:local,...override
  }),undefined,JSON.stringify(override));
});
