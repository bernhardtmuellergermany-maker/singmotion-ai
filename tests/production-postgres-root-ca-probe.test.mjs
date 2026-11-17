import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  publicPostgresRootCaConfig, validatePublicPostgresRootCa,
  probePublicPostgresRootCaOnce,
} from "../lib/ops/production-postgres-root-ca-probe.mjs";

const fixed="/var/lib/postgresql/data/certs/root.crt";
const now=Date.now()+5000;
const base={
  RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
  RAILWAY_SERVICE_NAME:"singmotion-ai",
  CMS_DATABASE_URL:"postgresql://fixture_user:fake_password@postgres.railway.internal:5432/fixture",
  PRODUCTION_POSTGRES_ROOT_CA_PROBE_EXPIRES_AT:new Date(now+15*60_000).toISOString(),
};
async function caFixture(){
  const dir=await mkdtemp(path.join(tmpdir(),"sm-public-pg-ca-"));
  const key=path.join(dir,"root.key"),pemFile=path.join(dir,"root.crt");
  try{
    execFileSync("openssl",["req","-new","-x509","-nodes","-days","91",
      "-newkey","rsa:3072","-subj","/CN=synthetic-public-root",
      "-keyout",key,"-out",pemFile],{stdio:["ignore","ignore","ignore"],timeout:20000});
    return {pem:await readFile(pemFile,"utf8")};
  }finally{await rm(dir,{recursive:true,force:true})}
}
test("no flag means public-CA discovery remains disabled",()=>{
  assert.equal(publicPostgresRootCaConfig({},now),null);
});
test("rejects wrong Railway service, public DB URL, old approval, and overlapping backup",()=>{
  const bad=[
    {RAILWAY_ENVIRONMENT_ID:"staging"},
    {RAILWAY_SERVICE_NAME:"Postgres"},
    {CMS_DATABASE_URL:"postgresql://user:p@public.example.org/db"},
    {CMS_DATABASE_URL:"postgresql://user:p@postgres.railway.internal/"},
    {PRODUCTION_POSTGRES_ROOT_CA_PROBE_EXPIRES_AT:new Date(now-1000).toISOString()},
    {PRODUCTION_POSTGRES_ROOT_CA_PROBE_EXPIRES_AT:new Date(now+31*60_000).toISOString()},
    {PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT:new Date(now+5000).toISOString()},
  ];
  for(const patch of bad)assert.throws(()=>publicPostgresRootCaConfig({...base,...patch},now));
});
test("strictly validates a self-signed public CA from the known PG volume path",async()=>{
  const {pem}=await caFixture();
  const out=validatePublicPostgresRootCa({cert_path:fixed,cert_pem:pem},now);
  assert.equal(out.publicOnly,true);
  assert.equal(Buffer.from(out.rootCaB64,"base64").toString("utf8"),pem.trim()+"\n");
  assert.match(out.derSha256,/^[0-9a-f]{64}$/);
  assert.ok(Date.parse(out.validUntil)>now+30*24*60*60*1000);
  for(const row of [
    {cert_path:"/var/lib/postgresql/data/certs/root.key",cert_pem:pem},
    {cert_path:fixed,cert_pem:"-----BEGIN PRIVATE KEY-----secret"},
    {cert_path:fixed,cert_pem:"garbage"},
    {cert_path:fixed,cert_pem:pem+"extra"},
    {cert_path:fixed,cert_pem:"x".repeat(16500)},
  ])assert.throws(()=>validatePublicPostgresRootCa(row,now));
});
test("one fixed read-only SQL query returns only the public CA and its fingerprint",async(t)=>{
  if(process.getuid?.()===0)return t.skip("nonroot private worker required");
  const {pem}=await caFixture();
  const events=[],calls=[];
  const output=await probePublicPostgresRootCaOnce(base,{
    now:()=>now,
    log:(...args)=>events.push(args),
    warn:(...args)=>events.push(["WARN",...args]),
    clientFactory:async(url)=>{
      assert.equal(url,base.CMS_DATABASE_URL);
      return {
        async connect(){calls.push("connect")},
        async query(sql){
          calls.push(sql);
          assert.match(sql,/^SELECT current_setting\('ssl_ca_file'\).* pg_read_file\('/);
          assert.ok(!/update|delete|insert|drop|alter|COPY|root\.key/i.test(sql));
          return {rows:[{cert_path:fixed,cert_pem:pem}]};
        },
        async end(){calls.push("end")},
      };
    },
  });
  assert.equal(output.status,"success");
  assert.equal(events[0][0],"PRODUCTION_PUBLIC_PG_ROOT_CA");
  const info=JSON.parse(events[0][1]);
  assert.equal(info.publicOnly,true);
  assert.equal(Buffer.from(info.rootCaB64,"base64").toString("utf8"),pem.trim()+"\n");
  assert.ok(!JSON.stringify(events).includes("fake_password"));
  assert.deepEqual([calls[0],calls.at(-1)],["connect","end"]);
});
test("a permission error fails closed without emitting SQL paths or DB credentials",async(t)=>{
  if(process.getuid?.()===0)return t.skip("nonroot private worker required");
  const events=[];
  const output=await probePublicPostgresRootCaOnce(base,{
    now:()=>now,log:(...args)=>events.push(args),
    warn:(...args)=>events.push(args),
    clientFactory:async()=>({
      async connect(){},async query(){throw Error("permission denied: secret_password")},
      async end(){},
    }),
  });
  assert.equal(output.status,"failed");
  assert.deepEqual(events,[["PUBLIC_PG_CA_PROBE_FAILED"]]);
});
