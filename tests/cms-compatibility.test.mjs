import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));

test("Payload Postgres, Next adapter and core use one exact compatible release",()=>{
 const version=pkg.dependencies.payload;
 assert.match(version,/^\d+\.\d+\.\d+$/);
 for(const name of ["payload","@payloadcms/db-postgres","@payloadcms/next"]){
  assert.equal(pkg.dependencies[name],version,name+" direct release");
  assert.equal(lock.packages["node_modules/"+name]?.version,version,name+" installed release");
 }
 const adapter=lock.packages["node_modules/@payloadcms/db-postgres"];
 assert.equal(lock.packages["node_modules/@payloadcms/drizzle"].version,version);
 assert.equal(adapter.dependencies["@payloadcms/drizzle"],version);
 for(const dependency of ["drizzle-kit","drizzle-orm"]){
  const pinned=adapter.dependencies[dependency];
  assert.match(pinned,/^\d+\.\d+\.\d+$/);
  assert.equal(lock.packages["node_modules/"+dependency].version,pinned,
   "CMS database driver must match the reviewed pinned adapter version");
 }
});
test("Payload PostgreSQL adapter and SQL builder load without connecting or migrating",async()=>{
 const {postgresAdapter,sql}=await import("@payloadcms/db-postgres");
 const {getPayload}=await import("payload");
 assert.equal(typeof postgresAdapter,"function");
 assert.equal(typeof sql,"function");
 assert.equal(typeof getPayload,"function");
 // Import and type-level contracts only: no PostgreSQL network access or migration.
});
