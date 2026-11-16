import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {
 authorizationURL,privatePath,scopeAllowed,parseGrant,seal,unseal,main
} from "../scripts/hidrive-backup-worker.mjs";

test("Native HiDrive OAuth URL uses registered default OOB redirect and user,rw",()=>{
 const u=new URL(authorizationURL("fake-client-id"));
 assert.equal(u.origin,"https://my.hidrive.com");
 assert.equal(u.pathname,"/client/authorize");
 assert.equal(u.searchParams.get("client_id"),"fake-client-id");
 assert.equal(u.searchParams.has("redirect_uri"),false,"explicit oob caused invalid redirect_uri (format)");
 assert.equal(u.searchParams.get("response_type"),"code");
 assert.equal(u.searchParams.get("scope"),"user,rw");
 assert.equal(u.searchParams.has("client_secret"),false);
 for(const x of ["bad id","a&admin=true","","?".repeat(12)])
  assert.throws(()=>authorizationURL(x));
});

test("safe OAuth grant diagnostics identify wrong scope vs missing token fields",()=>{
 const grant={
  access_token:"synthetic-access-token-123",
  refresh_token:"synthetic-refresh-token-123",
  scope:"rw,user",alias:"unit-account"
 };
 assert.equal(parseGrant(grant).scope,"rw,user");
 assert.equal(parseGrant({...grant,scope:"user,rw"}).scope,"user,rw");
 for(const scope of ["user,ro","ro,user","rw,admin","owner,rw","user,rw,owner",""]){
  assert.throws(()=>parseGrant({...grant,scope}),{message:"OAUTH_GRANT_SCOPE_NOT_USER_RW"});
 }
 assert.throws(()=>parseGrant({...grant,access_token:"bad"}),{message:"OAUTH_GRANT_ACCESS_TOKEN_INVALID"});
 assert.throws(()=>parseGrant({...grant,refresh_token:"bad"}),{message:"OAUTH_GRANT_REFRESH_TOKEN_INVALID"});
 assert.throws(()=>parseGrant(null),{message:"OAUTH_GRANT_ACCESS_TOKEN_INVALID"});
});

test("independent secret-derived AES-256-GCM state and synthetic object encryption",()=>{
 const secret="synthetic-unit-secret-"+randomBytes(24).toString("hex");
 const record={refresh_token:"unit-refresh-token-123456",access_token:"unit-access-token-123456",scope:"user,rw"};
 const first=seal(record,secret);
 const next=seal(record,secret);
 assert.notDeepEqual(first,next,"new random salt/nonce every encryption");
 assert.deepEqual(JSON.parse(unseal(first,secret).toString()),record);
 assert.throws(()=>unseal(first,secret+"-wrong"));
 const fixture=seal(Buffer.from("synthetic, never real customer data"),secret,"fixture");
 assert.equal(unseal(fixture,secret,"fixture").toString(),"synthetic, never real customer data");
 assert.throws(()=>unseal(first,secret,"fixture"));
 assert.throws(()=>unseal(fixture,secret,"oauth"));
 const broken=JSON.parse(first.toString());
 broken.ct=Buffer.from("modified-ciphertext").toString("base64");
 assert.throws(()=>unseal(Buffer.from(JSON.stringify(broken)),secret));
});

test("private HiDrive target never accepts public folders or path traversal",()=>{
 assert.equal(privatePath("safe.user-03"),"root/users/safe.user-03/SingMotion-DR");
 assert.equal(privatePath("safe.user-03","SingMotion-DR"),"root/users/safe.user-03/SingMotion-DR");
 for(const a of ["../admin","/users/other","admin/../owner","", "..", "a/b"])
  assert.throws(()=>privatePath(a));
 for(const f of ["public","../SingMotion-DR","SingMotion-DR/../../public"])
  assert.throws(()=>privatePath("safe.user-03",f));
 assert.equal(scopeAllowed("rw,user"),true);
 assert.equal(scopeAllowed("user,rw"),true);
 // A user may authorize a different scope than requested; reject escalation.
 for(const s of [
  "user,ro","admin,ro","admin,rw","rw,admin","owner,rw",
  "rw,owner","user,admin,rw","user,rw,owner","user,rw,ro",
  "user,rw,extra","user,user,rw","user,rw,rw","rw","ro",""
 ])assert.equal(scopeAllowed(s),false,"Unexpected elevated/invalid grant: "+s);
});

test("setup mode cannot contact HiDrive or source customer data",async()=>{
 const base={BACKUP_MODE:"SETUP_ONLY_NO_DATA_TRANSFER",BACKUP_ENABLED:"false",
  BACKUP_PROVIDER:"STRATO_HIDRIVE",RAILWAY_SERVICE_NAME:"singmotion-backup"};
 await main(base);
 for(const wrong of [
  {...base,BACKUP_ENABLED:"true"},
  {...base,BACKUP_MODE:"FULL_BACKUP"},
  {...base,RAILWAY_SERVICE_NAME:"singmotion-ai"},
  {...base,BACKUP_PROVIDER:"CLOUDFLARE"},
 ])await assert.rejects(main(wrong));
});

test("minimal Docker image never imports the live app or mounts its SQLite data",()=>{
 const docker=readFileSync(new URL("../Dockerfile.backup",import.meta.url),"utf8");
 const entry=readFileSync(new URL("../scripts/hidrive-backup-entrypoint.mjs",import.meta.url),"utf8");
 const worker=readFileSync(new URL("../scripts/hidrive-backup-worker.mjs",import.meta.url),"utf8");
 assert.match(docker,/node:24.22.1-bookworm-slim/);
 assert.match(docker,/COPY .*hidrive-backup-worker/);
 assert.ok(docker.includes("COPY --chmod=0444 scripts/hidrive-backup-worker.mjs /usr/local/lib/hidrive-backup-worker.mjs"));
 assert.ok(docker.includes("test -s /usr/local/lib/hidrive-backup-worker.mjs"));
 assert.ok(entry.includes('await import("/usr/local/lib/hidrive-backup-worker.mjs")'));

 assert.doesNotMatch(docker,/npm ci|NEXT_PUBLIC|COPY \.|EXPOSE 3000|app\/\.data/);
 assert.match(entry,/process\.setuid\(uid\)/);
 assert.match(entry,/process\.setgroups\(\[\]\)/);
 assert.ok(entry.includes('name==="lost+found"'));
 assert.ok(entry.includes('st.isDirectory()'));
 assert.match(entry,/continue;/);
 assert.ok(entry.includes('const tempName=/^\\.oauth-'));

 assert.match(entry,/await main\(\)/);
 assert.doesNotMatch(worker,/new CommerceStore|connect\(.*postgres|process\.env\.DATABASE_URL|R2_SECRET_ACCESS_KEY/);
 assert.match(worker,/BACKUP_ENABLED!=="false"/);
 assert.match(worker,/HIDRIVE_SYNTHETIC_TEST_APPROVED==="YES"/);
 assert.match(worker,/privatePath\(alias,folder\)/);
 assert.match(worker,/saveState\(fresh,secret\)/);
});
