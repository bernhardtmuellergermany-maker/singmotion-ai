/**
 * Run the existing destructive Payload CMS integration suite only inside a
 * throwaway PostgreSQL container on the developer's own Docker daemon.
 * No Railway, remote Postgres, migrations against existing DBs or paid API calls.
 *
 * Usage after npm ci: npm run test:cms:isolated
 * Optional after npm run build: npm run test:cms:isolated -- --browser
 */
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {assertDisposableCmsTestDatabase,assertSafeCmsLocalTestRunner}
 from "../cms/test-database-guard.mjs";

assertSafeCmsLocalTestRunner(process.env);
const browser=process.argv.slice(2).includes("--browser");
if(process.argv.slice(2).some(arg=>arg!=="--browser"))
 throw Error("Only --browser is supported");
const identifier=randomUUID().slice(0,12);
const name="singmotion-disposable-cms-"+identifier;
const dbName="singmotion_cms_"+identifier.replaceAll("-","")+"_test";
const user="cms_test_user";
const password=randomBytes(30).toString("hex");
let containerId;

function docker(args,options={}){
 const result=spawnSync("docker",args,{
  encoding:"utf8",timeout:45000,maxBuffer:512*1024,...options,
 });
 if(result.error||result.status!==0)
  throw Error("Local Docker command failed: "+args[0]+" "+
   (result.error?.message||String(result.stderr||"").slice(-400)));
 return String(result.stdout||"").trim();
}
function childRun(args,env,timeout){
 const result=spawnSync(process.execPath,args,{env,stdio:"inherit",timeout});
 if(result.error||result.signal||result.status!==0)
  throw Error("Isolated CMS test command failed ("+
   (result.error?.message||result.signal||result.status)+")");
}
try{
 docker(["info","--format","{{.ServerVersion}}"]);
 // There is no bind mount, named volume or external network endpoint. Docker
 // assigns a fresh, loopback-only host port and deletes the tmpfs on exit.
 containerId=docker([
  "run","--detach","--rm","--name",name,
  "--publish","127.0.0.1::5432",
  "--tmpfs","/var/lib/postgresql/data:rw,nosuid,nodev,size=1g",
  "--env","POSTGRES_USER="+user,
  "--env","POSTGRES_PASSWORD="+password,
  "--env","POSTGRES_DB="+dbName,
  "postgres:16-alpine",
 ]);
 const portText=docker(["port",containerId,"5432/tcp"]);
 const matched=/^127\.0\.0\.1:(\d+)$/m.exec(portText);
 if(!matched)throw Error("Disposable Postgres must be bound to 127.0.0.1 only");
 const port=Number(matched[1]);
 if(!Number.isSafeInteger(port)||port<1024||port>65535)
  throw Error("Invalid disposable Postgres port");
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
  const result=spawnSync("docker",["exec",containerId,"pg_isready","-U",user,"-d",dbName],{
   encoding:"utf8",timeout:5000,
  });
  if(result.status===0){ready=true;break;}
  await delay(250);
 }
 if(!ready)throw Error("Disposable PostgreSQL did not become ready");
 const url=`postgresql://${user}:${password}@127.0.0.1:${port}/${dbName}`;
 // Strictly verify the exact disposable connection before any Payload import.
 assertDisposableCmsTestDatabase({CMS_TEST_DATABASE_URL:url,NODE_ENV:"test"});
 // Positive allowlist: Railway secrets and existing remote database URLs are
 // NEVER inherited by the test process, even through unrelated app settings.
 const env={
  PATH:process.env.PATH||"",
  HOME:process.env.HOME||"",
  NODE_ENV:"test",
  CMS_TEST_DATABASE_URL:url,
  GENERATIONS_ENABLED:"false",
  BYTEPLUS_LIVE_TEST_ENABLED:"false",
  BYTEPLUS_FIRST_TEST_ENABLED:"false",
  STRIPE_LIVE_ENABLED:"false",
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  }:{}),
 };
 console.log("CMS_DISPOSABLE_DB_READY loopback Docker tmpfs; no existing database reused");
 childRun(["node_modules/tsx/dist/cli.mjs","--test","--test-force-exit","tests/cms.integration.ts"],
  env,360000);
 console.log("CMS_INTEGRATION_OK");
 if(browser){
  childRun(["node_modules/tsx/dist/cli.mjs","tests/cms.browser.ts"],env,360000);
  console.log("CMS_BROWSER_OK");
 }
}finally{
 if(containerId){
  const removal=spawnSync("docker",["rm","--force",containerId],{
   encoding:"utf8",timeout:30000,
  });
  if(removal.status!==0)
   console.error("CMS_DISPOSABLE_CONTAINER_CLEANUP_FAILED",name);
  else console.log("CMS_DISPOSABLE_CONTAINER_REMOVED");
 }
}
