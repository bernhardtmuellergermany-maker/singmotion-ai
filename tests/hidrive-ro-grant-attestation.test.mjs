import test from "node:test";
import assert from "node:assert/strict";
import { attestHiDriveReadOnlyGrant } from "../lib/ops/hidrive-ro-grant-attestation.mjs";

const token = JSON.stringify({
  access_token:"synthetic-access-token-for-ro-test",
  refresh_token:"synthetic-refresh-token-for-ro-test",
  token_type:"Bearer",
  expiry:"2027-01-01T00:00:00Z",
});
function conf(options={}) {
  return `[other]
type = local
[hidrive-ro]
type = hidrive
scope_access = ${options.access ?? "ro"}
scope_role = ${options.role ?? "user"}
token = ${token}
${options.extra ?? ""}
`;
}
const proof = (scope="ro,user") => async (access) => {
  assert.equal(access,"synthetic-access-token-for-ro-test");
  return {scope,expires_in:3600,client_id:"synthetic-client",alias:"synthetic-user"};
};

test("accepts verified actual user,ro grant and returns no confidential values", async () => {
  const check = await attestHiDriveReadOnlyGrant({
    configText:conf(), remoteName:"hidrive-ro",tokeninfo:proof(),
  });
  assert.deepEqual(check,{grantReadOnlyVerified:true,scope:"user,ro"});
  assert.ok(!JSON.stringify(check).includes("synthetic-"));
});

test("rejects already-granted rw token despite configured ro flags", async () => {
  await assert.rejects(attestHiDriveReadOnlyGrant({
    configText:conf(),remoteName:"hidrive-ro",tokeninfo:proof("rw,user"),
  }),/HIDRIVE_GRANTED_SCOPE_NOT_READONLY/);
});

test("rejects configured rw/admin/owner and missing scope", async () => {
  for (const options of [{access:"rw"},{role:"owner"},{role:"admin"},{extra:"scope_access = ro"}]) {
    await assert.rejects(attestHiDriveReadOnlyGrant({
      configText:conf(options),remoteName:"hidrive-ro",tokeninfo:proof(),
    }));
  }
});

test("rejects privileged, malformed and broad tokeninfo scopes", async () => {
  for (const scope of ["ro,user,owner","ro,admin","rw,owner","ro,ro","","user","ro"]) {
    await assert.rejects(attestHiDriveReadOnlyGrant({
      configText:conf(),remoteName:"hidrive-ro",tokeninfo:proof(scope),
    }),/HIDRIVE_GRANTED_SCOPE_NOT_READONLY/);
  }
});

test("rejects missing or duplicate config section and external auth endpoints", async () => {
  for (const configText of [
    conf()+"\n[hidrive-ro]\ntype = hidrive\n",
    "[unexpected]\ntype = hidrive\n",
    conf({extra:"auth_url = https://attacker.invalid\n"}),
    conf({extra:"endpoint = https://attacker.invalid\n"}),
    conf({extra:"client_credentials = true\n"}),
  ]) {
    await assert.rejects(attestHiDriveReadOnlyGrant({
      configText,remoteName:"hidrive-ro",tokeninfo:proof(),
    }));
  }
});

test("fail-closed on expired/failed tokeninfo, never exposes token", async () => {
  await assert.rejects(attestHiDriveReadOnlyGrant({
    configText:conf(),remoteName:"hidrive-ro",tokeninfo:async () => {throw Error("synthetic-private-access-token");},
  }),/TOKENINFO_UNAVAILABLE/);
  await assert.rejects(attestHiDriveReadOnlyGrant({
    configText:conf(),remoteName:"hidrive-ro",tokeninfo:async () => ({...await proof()("synthetic-access-token-for-ro-test"),expires_in:5}),
  }),/HIDRIVE_GRANTED_SCOPE_NOT_READONLY/);
});
