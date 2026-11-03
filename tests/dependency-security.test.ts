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

test("Drizzle legacy loader resolves only patched esbuild, with a functional native transformer",async()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 assert.equal(pkg.overrides?.["@esbuild-kit/core-utils"]?.esbuild,"0.25.12");
 const versions=Object.entries(lock.packages).filter(([name])=>
  name==="node_modules/esbuild"||name.endsWith("/node_modules/esbuild"));
 assert.ok(versions.length>0);
 for(const [name,item] of versions){
  const parts=String((item as {version:string}).version).split(".").map(Number);
  assert.ok(parts[0]>0||parts[1]>=25,`${name} must not contain vulnerable esbuild`);
 }
 assert.equal(lock.packages["node_modules/esbuild"].version,"0.25.12");
 assert.equal(lock.packages["node_modules/@esbuild-kit/core-utils/node_modules/esbuild"],undefined);
 assert.equal(lock.packages["node_modules/@esbuild/linux-x64"].version,"0.25.12");
 const esbuild=await import("esbuild");
 const out=await esbuild.transform("const amount: number = 42",{loader:"ts"});
 assert.match(out.code,/amount\s*=\s*42/);
});

test("vendored Payload deepmerge blocks prototype poisoning while preserving merge semantics",async()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 assert.equal(pkg.dependencies.deepmerge,"file:vendor/deepmerge");
 assert.equal(pkg.overrides.deepmerge,"$deepmerge");
 assert.equal(lock.packages["node_modules/deepmerge"].link,true);
 assert.equal(lock.packages["vendor/deepmerge"].version,"4.3.1-singmotion.1");
 const {createRequire}=await import("node:module");
 const req=createRequire(import.meta.url);
 const merge=req("deepmerge") as typeof import("../vendor/deepmerge/index.js");
 assert.equal(typeof merge,"function");
 const attacker=JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}},"prototype":{"polluted":true}}');
 const out=merge({settings:{enabled:true},roles:["member"]},attacker);
 assert.equal(Object.getPrototypeOf(out),Object.prototype);
 assert.equal(Object.hasOwn(out,"__proto__"),false);
 assert.equal(Object.hasOwn(out,"constructor"),false);
 assert.equal(Object.hasOwn(out,"prototype"),false);
 assert.equal((out as Record<string,unknown>).isAdmin,undefined);
 assert.equal(({} as Record<string,unknown>).isAdmin,undefined);
 assert.deepEqual(out.settings,{enabled:true});
 assert.deepEqual(out.roles,["member"]);
 assert.deepEqual(merge({nested:{left:true},items:[1]}, {nested:{right:true},items:[2]}),
  {nested:{left:true,right:true},items:[1,2]});
 assert.deepEqual(merge.all([{a:1},{b:2}]),{a:1,b:2});
 const inherited=Object.create(null) as Record<string,unknown>;
 Object.defineProperty(inherited,"__proto__",{value:{isAdmin:true},enumerable:true});
 assert.equal(Object.hasOwn(merge({},inherited),"__proto__"),false);
});
