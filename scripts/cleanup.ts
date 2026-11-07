import { removeOfflinePlans, expiredDemoOwners } from "../lib/live/cleanup.ts";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { db, dataDir, list } from "../lib/db.ts";
import type { Asset, Job } from "../lib/domain.ts";

// Cookie/session expiry is not a customer content-retention deadline.
// This script may purge ONLY expired random-UUID demo owners; never customer-
// or CMS-staff-owned projects, and never active or R2-mirrored demo assets.
const now=Date.now();
const owners=expiredDemoOwners(db,now);
const mediaRoot=path.resolve(dataDir,"media")+path.sep;
const hasCloudTable=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cloud_source_media'").get();
let removed=0,held=0;
for(const owner of owners){
 if(list<Job>("jobs",owner).some(j=>["queued","processing"].includes(j.status))){held++;continue}
 if(hasCloudTable && db.prepare("SELECT 1 FROM cloud_source_media WHERE owner=? LIMIT 1").get(owner)){
  // Cloud objects must be reconciled with their manifest before any deletion.
  held++;continue;
 }
 const assets=list<Asset>("assets",owner);
 if(assets.some(asset=>!path.resolve(asset.path).startsWith(mediaRoot))){
  // Never trust an unexpected path in a persisted record.
  held++;continue;
 }
 try{removeOfflinePlans(dataDir,owner)}catch{held++;continue}
 for(const asset of assets)await unlink(asset.path).catch(()=>{});
 for(const table of ["assets","artists","jobs","ledger","sessions"])
  db.prepare(`DELETE FROM ${table} WHERE owner=?`).run(owner);
 removed++;
}
// Expired tokens may be pruned safely without deleting customer-owned content.
db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
// A broad unregistered-file sweep is unsafe: paths may be referenced by
// customer orders, private R2 manifests, or recovery databases not in demo.sqlite.
// Leave orphan files for an explicitly reviewed cross-database reconciliation.
db.prepare("DELETE FROM rate_limits WHERE reset<?").run(now);
console.log(`Expired demo owners removed: ${removed}; held for safety: ${held}. Customer and unregistered media preserved.`);
db.close();
