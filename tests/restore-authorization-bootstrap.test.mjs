import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePrivateReadOnlyProfile} from '../scripts/restore-authorization-bootstrap.mjs';
const remote='hidrive-ro:SingMotion-DR';
const make=(override='')=>Buffer.from(override ||
  '[hidrive-ro]\ntype = hidrive\nscope_role = user\nscope_access = ro\ntoken = {"access_token":"aaaaaaaaaaaaaaaa","refresh_token":"bbbbbbbbbbbbbbbb"}\n').toString('base64');
test('accept only one strictly scoped read-only remote; actual granted scope separately tokeninfo verified',()=>{
  const raw=parsePrivateReadOnlyProfile(make(),remote);
  assert.match(raw.toString(),/scope_access = ro/);
});
test('reject invalid encoding, rw access, extra remote and missing tokens',()=>{
  const cases=[
    make().replace(/A/,'!'),
    make().slice(1),
    make('[hidrive-ro]\ntype=hidrive\nscope_role=user\nscope_access=rw\ntoken={"access_token":"aaaaaaaaaaaaaaaa","refresh_token":"bbbbbbbbbbbbbbbb"}\n'),
    make('[hidrive-ro]\ntype=hidrive\nscope_role=user\nscope_access=ro\ntoken={"access_token":"aaaaaaaaaaaaaaaa","refresh_token":"bbbbbbbbbbbbbbbb"}\n[other]\ntype=drive\n'),
    make('[hidrive-ro]\ntype=hidrive\nscope_role=user\nscope_access=ro\ntoken={}\n'),
  ];
  for(const c of cases)assert.throws(()=>parsePrivateReadOnlyProfile(c,remote));
});
test('reject config/remote mismatch',()=>assert.throws(()=>parsePrivateReadOnlyProfile(make(),'other:SingMotion-DR')));
test('rclone default user scope_role omitted is valid only if access is ro',()=>{
 const profile=make('[hidrive-ro]\\ntype = hidrive\\nscope_access = ro\\ntoken = {\"access_token\":\"aaaaaaaaaaaaaaaa\",\"refresh_token\":\"bbbbbbbbbbbbbbbb\"}\\n');
 assert.match(parsePrivateReadOnlyProfile(profile,remote).toString(),/scope_access = ro/);
 for(const role of ['admin','owner','']){
   const wrong=make('[hidrive-ro]\\ntype=hidrive\\nscope_access=ro\\nscope_role='+role+'\\ntoken={\"access_token\":\"aaaaaaaaaaaaaaaa\",\"refresh_token\":\"bbbbbbbbbbbbbbbb\"}\\n');
   assert.throws(()=>parsePrivateReadOnlyProfile(wrong,remote));
 }
});
