/**
 * One-shot, READ-ONLY discovery of the PUBLIC Railway Postgres root CA.
 *
 * Source: ghcr.io/railwayapp-templates/postgres-ssl:18, init-ssl.sh:
 *   /var/lib/postgresql/data/certs/root.crt
 *
 * This is NOT root.key, server.key, a database backup, or a user secret.
 * It prints only the validated public certificate and its DER fingerprint;
 * never prints credentials or any other DB data. Disabled by default.
 */
import { X509Certificate, createHash } from "node:crypto";

const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const CERT="/var/lib/postgresql/data/certs/root.crt";
const QUERY="SELECT current_setting('ssl_ca_file') AS cert_path, pg_read_file('"+
  CERT+"', 0, 16384, true) AS cert_pem";
const fail=(code)=>{throw Error(code)};

export function publicPostgresRootCaConfig(env,now=Date.now()) {
  const expiry=env.PRODUCTION_POSTGRES_ROOT_CA_PROBE_EXPIRES_AT;
  if(expiry===undefined || expiry==="")return null;
  if(env.RAILWAY_ENVIRONMENT_ID!==PRODUCTION ||
     env.RAILWAY_SERVICE_NAME!=="singmotion-ai" ||
     typeof env.CMS_DATABASE_URL!=="string" || !env.CMS_DATABASE_URL ||
     env.PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT ||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expiry))
    fail("PUBLIC_PG_CA_PROBE_ACTIVATION_REFUSED");
  const end=Date.parse(expiry);
  if(!Number.isFinite(end)||end<=now+1_000||end-now>30*60_000)
    fail("PUBLIC_PG_CA_PROBE_EXPIRED_OR_UNBOUNDED");
  let db;
  try {db=new URL(env.CMS_DATABASE_URL)}
  catch {fail("PUBLIC_PG_CA_PRIVATE_DB_REQUIRED")}
  if(!["postgres:","postgresql:"].includes(db.protocol) ||
     !db.hostname.endsWith(".railway.internal") ||
     db.hostname.length<16 || !db.username || !db.password ||
     !db.pathname || db.pathname==="/" || db.hash)
    fail("PUBLIC_PG_CA_PRIVATE_DB_REQUIRED");
  return {databaseUrl:env.CMS_DATABASE_URL,deadline:end};
}

export function validatePublicPostgresRootCa(row,now=Date.now()) {
  if(row?.cert_path!==CERT || typeof row?.cert_pem!=="string" ||
     row.cert_pem.length<400 || row.cert_pem.length>16_384 ||
     !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/.test(row.cert_pem))
    fail("PUBLIC_PG_CA_CERT_INVALID");
  let cert;
  try {cert=new X509Certificate(row.cert_pem)}
  catch {fail("PUBLIC_PG_CA_CERT_INVALID")}
  if(!cert.ca || !cert.verify(cert.publicKey) ||
     Date.parse(cert.validFrom)>now ||
     Date.parse(cert.validTo)<=now+30*24*60*60*1000)
    fail("PUBLIC_PG_CA_CERT_INVALID");
  const pem=row.cert_pem.trim()+"\n";
  return {
    rootCaB64:Buffer.from(pem,"utf8").toString("base64"),
    derSha256:createHash("sha256").update(cert.raw).digest("hex"),
    publicOnly:true,
    validUntil:new Date(cert.validTo).toISOString(),
  };
}

/** Existing application DB connection, restricted to a single fixed SELECT
 * over PostgreSQL's own public root CA path. No DDL, no DB mutations, no file
 * writes, and no R2/Stripe/HiDrive access. Fails closed on permissions.
 */
export async function probePublicPostgresRootCaOnce(env,{
  now=Date.now,log=()=>{},warn=()=>{},
  clientFactory=async(databaseUrl)=>{
    const {Client}=await import("pg");
    return new Client({connectionString:databaseUrl,connectionTimeoutMillis:10_000,
      query_timeout:10_000,statement_timeout:10_000});
  },
}={}){
  let config;
  try{config=publicPostgresRootCaConfig(env,now())}
  catch{warn("PUBLIC_PG_CA_PROBE_REFUSED");return {status:"refused"}}
  if(!config)return {status:"disabled"};
  if(process.getuid?.()===0 || now()>=config.deadline){
    warn("PUBLIC_PG_CA_PROBE_REFUSED");return {status:"refused"};
  }
  let client;
  try{
    client=await clientFactory(config.databaseUrl);
    await client.connect();
    const result=await client.query(QUERY);
    if(result?.rows?.length!==1)fail("PUBLIC_PG_CA_QUERY_INVALID");
    const summary=validatePublicPostgresRootCa(result.rows[0],now());
    if(now()>=config.deadline)fail("PUBLIC_PG_CA_PROBE_EXPIRED");
    log("PRODUCTION_PUBLIC_PG_ROOT_CA",JSON.stringify(summary));
    return {status:"success",summary};
  }catch{
    warn("PUBLIC_PG_CA_PROBE_FAILED");
    return {status:"failed"};
  }finally{
    try{await client?.end()}catch{ /* never leak credentials through errors */ }
  }
}
