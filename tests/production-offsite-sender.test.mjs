import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createTestPKI } from "../scripts/backup-network-certificates.mjs";
import { productionOffsiteSenderConfig, runProductionOffsiteOnce }
  from "../lib/ops/production-offsite-backup-sender.mjs";

const testNow=Date.now()+60_000;
async function fixture(){
  const pki=await createTestPKI("singmotion-backup.railway.internal");
  const rsa=generateKeyPairSync("rsa",{modulusLength:3072});
  const signing=generateKeyPairSync("ed25519");
  const b64=(key)=>Buffer.from(key.export({format:"pem",type:key.type==="private"?"pkcs8":"spki"})).toString("base64");
  return {
    RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
    RAILWAY_SERVICE_NAME:"singmotion-ai",
    DATA_DIR:"/app/.data",
    PRODUCTION_OFFSITE_BACKUP_MODE:"SINGLE_ENCRYPTED_UPLOAD_V1",
    PRODUCTION_OFFSITE_BACKUP_APPROVED:"YES",
    PRODUCTION_OFFSITE_BACKUP_RUN_ID:randomUUID(),
    PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT:new Date(testNow+60*60_000).toISOString(),
    BACKUP_RECEIVER_ORIGIN:"https://singmotion-backup.railway.internal:8443/",
    BACKUP_MTLS_CA_B64:pki.BACKUP_TEST_CA_B64,
    BACKUP_MTLS_WRITER_CERT_B64:pki.BACKUP_TEST_WRITER_CERT_B64,
    BACKUP_MTLS_WRITER_KEY_B64:pki.BACKUP_TEST_WRITER_KEY_B64,
    BACKUP_RECOVERY_PUBLIC_KEY_B64:b64(rsa.publicKey),
    BACKUP_SIGNING_PRIVATE_KEY_B64:b64(signing.privateKey),
    BACKUP_PG_ROOT_CERT_B64:pki.BACKUP_TEST_CA_B64,
    CMS_DATABASE_URL:"postgresql://backup%2Bfixture:s3cure%40fixture@postgres.railway.internal:5432/cms_fixture?sslmode=require",
    R2_ACCOUNT_ID:"a".repeat(32),
    R2_BUCKET:"customer-private",
    R2_ACCESS_KEY_ID:"fixture-r2-id",
    R2_SECRET_ACCESS_KEY:"fixture-r2-secret",
  };
}

test("disabled without time-limited explicit approval and independent public recovery key",()=>{
  assert.equal(productionOffsiteSenderConfig({},testNow),null);
});
test("exact live environment private hostname, RSA-3072, signed mTLS identity and verified-full PG settings",async()=>{
  const env=await fixture();
  const config=productionOffsiteSenderConfig(env,testNow);
  assert.equal(config.run,env.PRODUCTION_OFFSITE_BACKUP_RUN_ID);
  assert.equal(config.pg.targetHost,"postgres.railway.internal");
  assert.equal(config.pg.PGHOST,"localhost");
  assert.equal(config.pg.PGSSLMODE,"verify-full");
  assert.equal(config.pg.PGUSER,"backup+fixture");
  assert.equal(config.pg.PGPASSWORD,"s3cure@fixture");
  assert.equal(config.pg.PGDATABASE,"cms_fixture");
  assert.equal(config.recoveryPublicKey.asymmetricKeyType,"rsa");
  assert.equal(config.signingPrivateKey.asymmetricKeyType,"ed25519");
  assert.equal(JSON.stringify(config).includes("STRIPE"),false);
});
test("refuse unbounded, wrong environment, weak key, missing private TLS, public host and recovery PRIVATE key",async()=>{
  const base=await fixture();
  const weak=generateKeyPairSync("rsa",{modulusLength:2048});
  const changes=[
    {RAILWAY_SERVICE_NAME:"Postgres"},
    {RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"},
    {PRODUCTION_OFFSITE_BACKUP_MODE:"READONLY"},
    {PRODUCTION_OFFSITE_BACKUP_APPROVED:""},
    {PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT:new Date(testNow-500).toISOString()},
    {PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT:new Date(testNow+3*60*60_000).toISOString()},
    {PRODUCTION_OFFSITE_BACKUP_RUN_ID:"../../state"},
    {BACKUP_RECEIVER_ORIGIN:"https://example.com/"},
    {BACKUP_MTLS_WRITER_KEY_B64:"invalid"},
    {BACKUP_RECOVERY_PRIVATE_KEY_B64:"must-not-be-on-railway"},
    {HIDRIVE_CLIENT_SECRET:"must-not-be-on-app"},
    {BACKUP_RECOVERY_PUBLIC_KEY_B64:Buffer.from(weak.publicKey.export({format:"pem",type:"spki"})).toString("base64")},
    {CMS_DATABASE_URL:"postgresql://u:p@public.example.net:5432/cms"},
    {CMS_DATABASE_URL:"postgresql://u:p@postgres.railway.internal:5432/"},
    {R2_ACCOUNT_ID:"wrong"},
  ];
  for(const patch of changes)
    assert.throws(()=>productionOffsiteSenderConfig({...base,...patch},testNow));
});
test("operator-approved one-shot sender forwards only encrypted sink, pinned TLS PG trust and R2 scope",async(t)=>{
  if(process.getuid?.()===0)return t.skip("nonroot app runtime is required");
  const env=await fixture();
  const events=[],warnings=[],calls=[];
  const output=await runProductionOffsiteOnce(env,{
    now:()=>testNow,
    resolveHost:async(host)=>{assert.equal(host,"postgres.railway.internal");return {address:"fd12:3456::1"};},
    log:(...args)=>events.push(args),warn:(...args)=>warnings.push(args),
    createR2:(cfg)=>{
      calls.push({type:"r2",config:cfg});
      return {close:()=>calls.push({type:"close"})};
    },
    createSink:(cfg)=>{
      calls.push({type:"sink",config:cfg});
      return {putStream:async()=>{},commit:async()=>{}};
    },
    producer:async(cfg)=>{
      calls.push({type:"producer",config:{
        runId:cfg.runId,
        pg:cfg.pgEnv,
        sourceDir:cfg.sourceDir,scratchParent:cfg.scratchParent,
        hasPrivateKey:JSON.stringify(cfg.recoveryPublicKey).includes("PRIVATE"),
      }});
      assert.equal(cfg.recoveryPublicKey.asymmetricKeyType,"rsa");
      assert.equal(cfg.signingPrivateKey.asymmetricKeyType,"ed25519");
      return {
        run:cfg.runId,manifestId:randomUUID(),
        manifestMeta:{bytes:250,sha256:"a".repeat(64)},
        files:5,segments:20,bytes:123456,
        stores:{sqlite:3,postgres:1,r2:1,local:0},
        remoteReceiptCommitted:true,independentRestoreVerified:false,
      };
    },
  });
  assert.equal(output.status,"committed");
  assert.equal(events[0][0],"PRODUCTION_OFFSITE_BACKUP_COMMITTED");
  assert.equal(warnings.length,0);
  assert.equal(calls.find(x=>x.type==="producer").config.pg.PGSSLMODE,"verify-full");
  assert.equal(calls.find(x=>x.type==="producer").config.pg.PGHOSTADDR,"fd12:3456::1");
  assert.equal(calls.find(x=>x.type==="producer").config.runId,env.PRODUCTION_OFFSITE_BACKUP_RUN_ID);
  assert.equal(calls.find(x=>x.type==="sink").config.origin,env.BACKUP_RECEIVER_ORIGIN);
  assert.ok(calls.find(x=>x.type==="close"));
  assert.equal(JSON.stringify(events).includes("s3cure@fixture"),false);
  assert.equal(JSON.stringify(events).includes("fixture-r2-secret"),false);
  assert.equal(JSON.stringify(events).includes("BEGIN PRIVATE"),false);
});
test("a remote receipt with unexpected run ID cannot falsely report completion",async(t)=>{
  if(process.getuid?.()===0)return t.skip("nonroot app runtime is required");
  const env=await fixture();
  const logs=[],warnings=[];
  const out=await runProductionOffsiteOnce(env,{
    now:()=>testNow,resolveHost:async()=>({address:"10.0.0.42"}),log:(...args)=>logs.push(args),
    warn:(...args)=>warnings.push(args),
    createR2:()=>({close:()=>{}}),
    createSink:()=>({}),
    producer:async()=>({
      remoteReceiptCommitted:true,independentRestoreVerified:false,
      run:randomUUID(),
    }),
  });
  assert.equal(out.status,"failed");
  assert.deepEqual(warnings,[["PRODUCTION_OFFSITE_BACKUP_FAILED"]]);
  assert.equal(logs.length,0);
});

test("private PG DNS cannot resolve to public or loopback address, no cloud requests are made",async(t)=>{
  if(process.getuid?.()===0)return t.skip("nonroot app runtime is required");
  const env=await fixture();
  const events=[],warnings=[];
  const out=await runProductionOffsiteOnce(env,{
    now:()=>testNow,resolveHost:async()=>({address:"8.8.8.8"}),
    createR2:()=>{throw Error("SHOULD_NOT_CONTACT_R2");},
    createSink:()=>{throw Error("SHOULD_NOT_CONTACT_RECEIVER");},
    warn:marker=>warnings.push(marker),log:marker=>events.push(marker),
  });
  assert.equal(out.status,"failed");
  assert.deepEqual(warnings,["PRODUCTION_OFFSITE_BACKUP_FAILED"]);
  assert.equal(events.length,0);
});
