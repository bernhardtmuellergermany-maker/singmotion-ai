import { unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { db, dataDir, list } from "../lib/db.ts";
import type { Asset, Job } from "../lib/domain.ts";
const owners = db
  .prepare("SELECT owner FROM sessions WHERE expires<?")
  .all(Date.now()) as { owner: string }[];
for (const { owner } of owners) {
  if (
    list<Job>("jobs", owner).some((j) =>
      ["queued", "processing"].includes(j.status),
    )
  )
    continue;
  for (const a of list<Asset>("assets", owner))
    await unlink(a.path).catch(() => {});
  for (const table of ["assets", "artists", "jobs", "ledger", "sessions"])
    db.prepare(`DELETE FROM ${table} WHERE owner=?`).run(owner);
}
// Remove abandoned upload/trim files after one day; never remove referenced assets.
const referenced = new Set(
  (db.prepare("SELECT data FROM assets").all() as { data: string }[]).map(
    (r) => (JSON.parse(r.data) as Asset).path,
  ),
);
for (const name of await readdir(path.join(dataDir, "media"))) {
  const file = path.join(dataDir, "media", name);
  if (
    !referenced.has(file) &&
    (await stat(file)).mtimeMs < Date.now() - 86400000
  )
    await unlink(file);
}
db.prepare("DELETE FROM rate_limits WHERE reset<?").run(Date.now());
console.log(
  `Expired demo sessions cleaned: ${owners.length}. Active jobs preserved.`,
);
db.close();
