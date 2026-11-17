/**
 * Guarded, once-per-worker-boot, non-root Production offsite backup.
 * No public HTTP route, default-off, no mutation of live SQLite/Postgres/R2.
 * A valid approved run, verified PG TLS, externally held RSA recovery key,
 * pinned TLS writer identity and private Railway receiver are prerequisites.
 * NEVER supplies the recovery private key to the application or HiDrive.
 */
import { X509Certificate, createPublicKey, createPrivateKey } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { privateWorkerSink, isPrivateNetworkAddress } from "./private-backup-worker.mjs";
import { produceMultiStoreArchive } from "./multistore-segmented-backup.mjs";

const PROD="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const refuse=(code)=>{throw Error(code)};
const FIELDS=Object.freeze([
  "BACKUP_MTLS_CA_B64","BACKUP_MTLS_WRITER_CERT_B64",
  "BACKUP_MTLS_WRITER_KEY_B64","BACKUP_RECOVERY_PUBLIC_KEY_B64",
  "BACKUP_SIGNING_PRIVATE_KEY_B64","BACKUP_PG_ROOT_CERT_B64",
]);
function pem(env,key) {
  const value=env[key];
  if(typeof value!=="string" || value.length<80 || value.length>25_000 ||
     value.length%4!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    refuse("OFFSITE_PUBLIC_CERT_OR_KEY_MISSING");
  return Buffer.from(value,"base64");
}
function pgConnection(url) {
  let parsed;
  try { parsed=new URL(url); } catch { refuse("OFFSITE_PG_URL_INVALID"); }
  if(!["postgresql:","postgres:"].includes(parsed.protocol) ||
     !parsed.hostname.endsWith(".railway.internal") ||
     !parsed.username || !parsed.password || !parsed.pathname ||
     parsed.pathname==="/" || !/^\d{0,5}$/.test(parsed.port) ||
     parsed.hash)
    refuse("OFFSITE_PG_CONNECTION_NOT_PRIVATE");
  return {
    // Railway's postgres-ssl:18 generates a certificate whose DNS SAN is
    // "localhost". Resolve the trusted internal service separately and use
    // PGHOSTADDR for TCP while PGHOST controls verify-full hostname checking.
    targetHost:parsed.hostname,
    PGHOST:"localhost",
    PGPORT:parsed.port||"5432",
    PGUSER:decodeURIComponent(parsed.username),
    PGPASSWORD:decodeURIComponent(parsed.password),
    PGDATABASE:decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE:"verify-full",
    PGCONNECT_TIMEOUT:"10",
  };
}
export function productionOffsiteSenderConfig(env,now=Date.now()) {
  if (env.PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT === undefined ||
      env.PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT === "")
    return null;
  if (env.RAILWAY_ENVIRONMENT_ID!==PROD ||
      env.RAILWAY_SERVICE_NAME!=="singmotion-ai" ||
      env.DATA_DIR!=="/app/.data" ||
      env.PRODUCTION_OFFSITE_BACKUP_MODE!=="SINGLE_ENCRYPTED_UPLOAD_V1" ||
      env.PRODUCTION_OFFSITE_BACKUP_APPROVED!=="YES" ||
      !UUID.test(env.PRODUCTION_OFFSITE_BACKUP_RUN_ID??"") ||
      env.BACKUP_RECOVERY_PRIVATE_KEY_B64 || env.HIDRIVE_CLIENT_SECRET ||
      env.HIDRIVE_AUTH_CODE ||
      env.BACKUP_RECEIVER_ORIGIN!=="https://singmotion-backup.railway.internal:8443/" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(
        env.PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT
      ))
    refuse("OFFSITE_PRODUCTION_ACTIVATION_REFUSED");
  const expiry=Date.parse(env.PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT);
  if (!Number.isFinite(expiry) || expiry<=now+60_000 ||
      expiry-now>2*60*60*1000)
    refuse("OFFSITE_PRODUCTION_EXPIRY_INVALID");
  for(const key of ["CMS_DATABASE_URL","R2_ACCOUNT_ID","R2_BUCKET",
    "R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"])
    if(typeof env[key]!=="string"||!env[key])
      refuse("OFFSITE_SOURCE_CONFIGURATION_MISSING");
  if(!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID) ||
     !/^[a-z0-9][a-z0-9-]{1,62}$/.test(env.R2_BUCKET))
    refuse("OFFSITE_R2_SCOPE_INVALID");
  const pg=pgConnection(env.CMS_DATABASE_URL);
  const parts=Object.fromEntries(FIELDS.map(key=>[key,pem(env,key)]));
  let ca,writerCert,writerPrivate,pgRoot,recoveryPublic,signerPrivate;
  try {
    ca=new X509Certificate(parts.BACKUP_MTLS_CA_B64);
    writerCert=new X509Certificate(parts.BACKUP_MTLS_WRITER_CERT_B64);
    writerPrivate=createPrivateKey(parts.BACKUP_MTLS_WRITER_KEY_B64);
    pgRoot=new X509Certificate(parts.BACKUP_PG_ROOT_CERT_B64);
    recoveryPublic=createPublicKey(parts.BACKUP_RECOVERY_PUBLIC_KEY_B64);
    signerPrivate=createPrivateKey(parts.BACKUP_SIGNING_PRIVATE_KEY_B64);
  }catch{refuse("OFFSITE_CERTIFICATE_OR_KEY_INVALID")}
  if(!ca.ca || !writerCert.verify(ca.publicKey) ||
     !writerCert.checkPrivateKey(writerPrivate) ||
     Date.parse(ca.validFrom)>now || Date.parse(ca.validTo)<=expiry ||
     Date.parse(writerCert.validFrom)>now ||
     Date.parse(writerCert.validTo)<=expiry ||
     Date.parse(writerCert.validTo)-now>7*24*60*60*1000 ||
     !pgRoot.ca || Date.parse(pgRoot.validFrom)>now || Date.parse(pgRoot.validTo)<expiry ||
     recoveryPublic.asymmetricKeyType!=="rsa" ||
     recoveryPublic.asymmetricKeyDetails?.modulusLength<3072 ||
     signerPrivate.asymmetricKeyType!=="ed25519")
    refuse("OFFSITE_CERTIFICATE_OR_KEY_POLICY_FAILED");
  return {
    expiresAt:expiry,run:env.PRODUCTION_OFFSITE_BACKUP_RUN_ID,
    sourceDir:env.DATA_DIR,pg,
    r2:{account:env.R2_ACCOUNT_ID,bucket:env.R2_BUCKET,
      accessKey:env.R2_ACCESS_KEY_ID,secretKey:env.R2_SECRET_ACCESS_KEY},
    pgCert:parts.BACKUP_PG_ROOT_CERT_B64,
    tls:{ca:parts.BACKUP_MTLS_CA_B64,
      cert:parts.BACKUP_MTLS_WRITER_CERT_B64,
      key:parts.BACKUP_MTLS_WRITER_KEY_B64},
    recoveryPublicKey:recoveryPublic, signingPrivateKey:signerPrivate,
    receiver:env.BACKUP_RECEIVER_ORIGIN,
  };
}
function s3Adapter(config) {
  const client=new S3Client({
    region:"auto",
    endpoint:"https://"+config.account+".r2.cloudflarestorage.com",
    credentials:{accessKeyId:config.accessKey,secretAccessKey:config.secretKey},
    maxAttempts:2,
    forcePathStyle:true,
  });
  return {
    async list(ContinuationToken) {
      return client.send(new ListObjectsV2Command({
        Bucket:config.bucket,MaxKeys:1000,
        ...(ContinuationToken?{ContinuationToken}:{}),
      }),{abortSignal:AbortSignal.timeout(30_000)});
    },
    async get(key,etag) {
      return client.send(new GetObjectCommand({
        Bucket:config.bucket,Key:key,IfMatch:etag,
      }),{abortSignal:AbortSignal.timeout(120_000)});
    },
    close(){client.destroy()},
  };
}
/** Emits ONLY safe fixed markers and bounded counts, never client secrets,
 * certificate bodies, database URLs, source paths or R2 object names. */
export async function runProductionOffsiteOnce(env,{
  now=Date.now,log=()=>{},warn=()=>{},
  resolveHost=lookup,
  createR2=s3Adapter,createSink=privateWorkerSink,
  producer=produceMultiStoreArchive,
}={}) {
  let config;
  try {config=productionOffsiteSenderConfig(env,now());}
  catch {warn("PRODUCTION_OFFSITE_BACKUP_REFUSED");return {status:"refused"};}
  if(!config) return {status:"disabled"};
  if(process.getuid?.()===0 || now()+60_000>=config.expiresAt) {
    warn("PRODUCTION_OFFSITE_BACKUP_REFUSED");
    return {status:"refused"};
  }
  let scratch,r2;
  try {
    scratch=await mkdtemp(path.join(tmpdir(),"singmotion-backup-private-"));
    const pgCertFile=path.join(scratch,"pg-root.crt");
    await writeFile(pgCertFile,config.pgCert,{flag:"wx",mode:0o600});
    const {targetHost,...pg} = config.pg;
    const {address}=await resolveHost(targetHost);
    if(!isPrivateNetworkAddress(address)) refuse("OFFSITE_PG_NOT_PRIVATE");
    r2=createR2(config.r2);
    // All outgoing traffic goes to private receiver; never directly to
    // public HiDrive, Stripe/BytePlus, or arbitrary operator-provided host.
    const sink=createSink({origin:config.receiver,tls:config.tls});
    const result=await producer({
      sourceDir:config.sourceDir,scratchParent:scratch,
      runId:config.run,
      pgEnv:{...pg,PGHOSTADDR:address,PGSSLROOTCERT:pgCertFile},
      r2,sink,
      recoveryPublicKey:config.recoveryPublicKey,
      signingPrivateKey:config.signingPrivateKey,
      maxDurationMs:Math.min(60*60*1000,config.expiresAt-now()-1000),
    });
    if(!result?.remoteReceiptCommitted ||
       result.independentRestoreVerified!==false ||
       result.run!==config.run) {
      // Producer chooses a random run. The server is bound to the operator
      // approved run and MUST be sent this exact run ID; no silent mismatch.
      refuse("OFFSITE_COMMIT_OR_RUN_MISMATCH");
    }
    const summary={
      run:result.run,manifestId:result.manifestId,
      manifestMeta:result.manifestMeta,
      files:result.files,segments:result.segments,bytes:result.bytes,
      stores:result.stores,remoteReceiptCommitted:true,
      independentRestoreVerified:false,
    };
    log("PRODUCTION_OFFSITE_BACKUP_COMMITTED",JSON.stringify(summary));
    return {status:"committed",summary};
  }catch{
    warn("PRODUCTION_OFFSITE_BACKUP_FAILED");
    return {status:"failed"};
  }finally {
    r2?.close?.();
    if(scratch) await rm(scratch,{recursive:true,force:true});
  }
}
