import test from "node:test";
import assert from "node:assert/strict";
import { buildHiDriveUserCandidates } from "../scripts/hidrive-readonly-commit-preflight.mjs";

test("finds read-only receipt candidate beneath HiDrive users, without exposing alias", () => {
  const candidates = buildHiDriveUserCandidates(
    "hidrive-ro:SingMotion-DR",
    "user-one/\naccount_2/\n"
  );
  assert.deepEqual(candidates, [
    "hidrive-ro:users/user-one/SingMotion-DR",
    "hidrive-ro:users/account_2/SingMotion-DR",
  ]);
});

test("rejects traversal, invalid user entries and duplicates", () => {
  const candidates = buildHiDriveUserCandidates(
    "hidrive-ro:SingMotion-DR",
    "../\nuser-one/\nuser-one/\n../../secrets/\nother dir/\n"
  );
  assert.deepEqual(candidates, ["hidrive-ro:users/user-one/SingMotion-DR"]);
});

test("only root SingMotion-DR remote is eligible for scoped user discovery", () => {
  assert.throws(() => buildHiDriveUserCandidates(
    "hidrive-ro:users/someone/SingMotion-DR", "someone/\n"
  ), /HIDRIVE_DISCOVERY_INPUT_INVALID/);
  assert.throws(() => buildHiDriveUserCandidates(
    "hidrive-ro:anything", "someone/\n"
  ), /HIDRIVE_DISCOVERY_INPUT_INVALID/);
});

test("limits user discovery fanout", () => {
  const dirs = Array.from({length:33}, (_,i)=>"user"+i+"/").join("\n");
  assert.throws(() => buildHiDriveUserCandidates("hidrive-ro:SingMotion-DR", dirs),
    /HIDRIVE_USER_CANDIDATE_LIMIT/);
});
