// Isolated Docker regression test. Never connects to Railway or provider APIs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
const image = "node:24-bookworm-slim";
const suffix = randomBytes(6).toString("hex");
const volume = `sm-volume-test-${suffix}`;
const badVolume = `sm-volume-links-${suffix}`;
const container = `sm-startup-test-${suffix}`;
const repo = process.cwd();
const password = randomBytes(32).toString("hex");
const env = { ...process.env, STAGING_PASSWORD: password };
function docker(args) {
  return execFileSync("docker", args, {
    env,
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
const mounted = (name) => [
  "--network",
  "none",
  "-v",
  `${repo}:/app:ro`,
  "-v",
  `${name}:/app/.data`,
  "-v",
  `${path.join(repo, "scripts/container-entrypoint.mjs")}:/usr/local/lib/singmotion-entrypoint.mjs:ro`,
  "-w",
  "/app",
];
const variables = [
  "-e",
  "DATA_DIR=/app/.data",
  "-e",
  "NODE_ENV=production",
  "-e",
  "STAGING_AUTH_ENABLED=true",
  "-e",
  "STAGING_PASSWORD",
  "-e",
  "DEMO_MODE=true",
  "-e",
  "GENERATIONS_ENABLED=false",
  "-e",
  "ADMIN_DEMO_ENABLED=false",
  "-e",
  "BYTEPLUS_LIVE_TEST_ENABLED=false",
  "-e",
  "PORT=3198",
];
const entry = [image, "node", "/usr/local/lib/singmotion-entrypoint.mjs"];
function inside(code) {
  return docker([
    "exec",
    "--user",
    "1000:1000",
    container,
    "node",
    "--input-type=module",
    "-e",
    code,
  ]);
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if (
        inside(
          'console.log((await fetch("http://127.0.0.1:3198/studio")).status)',
        ) === "401"
      )
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Container did not start: " + docker(["logs", container]));
}
try {
  docker(["volume", "create", volume]);
  docker([
    "run",
    "--rm",
    "--network",
    "none",
    "-v",
    `${volume}:/app/.data`,
    image,
    "node",
    "-e",
    `
    const fs=require('fs');const {DatabaseSync}=require('node:sqlite');
    fs.mkdirSync('/app/.data/media',{mode:0o700});
    fs.writeFileSync('/app/.data/media/existing.mp4','original-media-bytes',{mode:0o600});
    const db=new DatabaseSync('/app/.data/demo.sqlite');
    db.exec("CREATE TABLE preservation_test(value TEXT); INSERT INTO preservation_test VALUES ('keep me')");db.close();
    fs.chmodSync('/app/.data',0o700);
    if(fs.statSync('/app/.data').uid!==0)throw Error('fixture must be root-owned');
  `,
  ]);
  // The exact privileged initializer starts the real production web/worker code.
  docker([
    "run",
    "-d",
    "--name",
    container,
    ...mounted(volume),
    ...variables,
    ...entry,
  ]);
  await ready();
  for (let pass = 0; pass < 2; pass++) {
    assert.equal(
      inside(`
      import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
      if(fs.readFileSync('/app/.data/media/existing.mp4','utf8')!=='original-media-bytes')throw Error('media changed');
      const db=new DatabaseSync('/app/.data/demo.sqlite');
      if(db.prepare('SELECT value FROM preservation_test').get().value!=='keep me')throw Error('database changed');db.close();
      for(const p of ['/app/.data','/app/.data/media','/app/.data/media/existing.mp4','/app/.data/demo.sqlite']){
        const stat=fs.statSync(p);if(stat.uid!==1000||stat.gid!==1000)throw Error('wrong ownership');
        if((stat.mode&0o077)!==0)throw Error('storage not private');
      }
      if(Date.now()-Number(fs.readFileSync('/app/.data/worker-heartbeat','utf8'))>5000)throw Error('worker missing');
      const ids=fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x));let processes=0;
      for(const id of ids){try{
        const command=fs.readFileSync('/proc/'+id+'/cmdline','utf8');
        if(command.includes('container-entrypoint')||command.includes('next-server')||command.includes('scripts/worker.ts')){
          const status=fs.readFileSync('/proc/'+id+'/status','utf8');
          if(!/^Uid:\\s+1000\\s+1000\\s+1000\\s+1000$/m.test(status))throw Error('root process');processes++;
        }
      }catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')throw e;}}
      if(processes<3)throw Error('expected launcher, web and worker');
      const authorization='Basic '+Buffer.from('staging:'+process.env.STAGING_PASSWORD).toString('base64');
      if((await fetch('http://127.0.0.1:3198/studio',{headers:{authorization}})).status!==200)throw Error('authenticated access failed');
      console.log('verified');
    `),
      "verified",
    );
    if (pass === 0) {
      docker(["restart", container]);
      await ready();
    }
  }
  // Entry invoked without root also works once ownership is repaired.
  docker(["rm", "-f", container]);
  docker([
    "run",
    "-d",
    "--name",
    container,
    "--user",
    "1000:1000",
    ...mounted(volume),
    ...variables,
    ...entry,
  ]);
  await ready();
  docker(["volume", "create", badVolume]);
  for (const kind of ["symlink", "hardlink"]) {
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "-v",
      `${badVolume}:/app/.data`,
      image,
      "node",
      "-e",
      `
      const fs=require('fs');
      fs.rmSync('/app/.data/link',{force:true});
      if('${kind}'==='symlink') fs.symlinkSync('/etc/passwd','/app/.data/link');
      else {fs.writeFileSync('/app/.data/source','untouched');fs.linkSync('/app/.data/source','/app/.data/link');}
    `,
    ]);
    assert.throws(
      () =>
        docker(["run", "--rm", ...mounted(badVolume), ...variables, ...entry]),
      "unsafe links must fail closed",
    );
  }
  assert.throws(
    () =>
      docker([
        "run",
        "--rm",
        ...mounted(volume),
        ...variables,
        image,
        "node",
        "scripts/serve.mjs",
      ]),
    "direct root launch must fail",
  );
  console.log(
    "Root-owned volume repaired; database/media preserved across restart; web and worker UID 1000; non-root restart and unsafe-link/root-launch rejection passed.",
  );
} finally {
  try {
    docker(["rm", "-f", container]);
  } catch {}
  for (const name of [volume, badVolume]) {
    try {
      docker(["volume", "rm", name]);
    } catch {}
  }
}
