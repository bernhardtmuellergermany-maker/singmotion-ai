import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import sharp from "sharp";

test("critical DOMPurify XSS regression cannot enter the locked production dependency graph",()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 assert.equal(pkg.overrides?.dompurify,"3.4.17");
 const item=lock.packages["node_modules/dompurify"];
 assert.ok(item,"DOMPurify must be present to verify its locked version");
 assert.equal(item.version,"3.4.17");
 assert.equal(item.resolved,"https://registry.npmjs.org/dompurify/-/dompurify-3.4.17.tgz");
 assert.equal(item.integrity,"sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==");
});

test("patched sharp version loads its packaged libvips and can convert and resize a customer image",async()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 assert.equal(pkg.dependencies.sharp,"0.35.5");
 assert.equal(lock.packages[""].dependencies.sharp,"0.35.5");
 assert.equal(lock.packages["node_modules/sharp"].version,"0.35.5");
 assert.equal(lock.packages["node_modules/@img/sharp-linux-x64"].version,"0.35.5");
 assert.equal(lock.packages["node_modules/@img/sharp-libvips-linux-x64"].version,"1.3.4");
 const input=await sharp({create:{width:4,height:3,channels:3,background:{r:20,g:40,b:60}}}).png().toBuffer();
 const output=await sharp(input).resize(8,6).png().toBuffer();
 const metadata=await sharp(output).metadata();
 assert.equal(metadata.format,"png");
 assert.equal(metadata.width,8);
 assert.equal(metadata.height,6);
});
