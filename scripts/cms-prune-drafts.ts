/** Staging ONLY: inspect or prune CMS pages that have NEVER been live.
 * Requires an immutable 0600 JSON backup before any deletion. Does not touch
 * public app routes, homepage components or legal templates.
 *
 * npm run cms:prune-drafts -- --dry-run
 * npm run cms:prune-drafts -- --apply
 */
import path from "node:path";
import {lstat,mkdir,open,realpath,readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {getPayload} from "payload";
import config from "../payload.config.ts";
import {planCmsPageCleanup,type CmsPageInventory} from "../cms/page-cleanup-policy.ts";
import {cmsArchiveDigest,verifyCmsArchiveReadback,hasChangedCmsVersions} from "../cms/draft-archive-integrity.ts";

const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const mode=process.argv[2];
if(!["--dry-run","--apply"].includes(mode)||process.argv.length!==3||
 process.env.RAILWAY_ENVIRONMENT_ID!==STAGING||
 process.env.CMS_ENABLED!=="true"||
 process.env.CMS_PRUNE_DRAFTS_APPROVED!=="true")
 throw Error("Staging-only CMS draft cleanup needs explicit operator approval and --dry-run/--apply");
const payload=await getPayload({config});
const archiveRoot=path.resolve(process.env.DATA_DIR||".data","cms-draft-archives");
try{
 // No backup path may be symlinked, and we refuse public /tmp locations.
 const dataRoot=await realpath(path.resolve(process.env.DATA_DIR||".data"));
 await mkdir(archiveRoot,{recursive:true,mode:0o700});
 const archiveStat=await lstat(archiveRoot);
 if(!archiveStat.isDirectory()||archiveStat.isSymbolicLink()||
  await realpath(archiveRoot)!==path.join(dataRoot,"cms-draft-archives"))
  throw Error("Unsafe CMS archive destination");
 const docs: Array<Record<string,unknown>>=[];
 for(let page=1;page<=10;page++){
  const result=await payload.find({collection:"pages",page,limit:100,depth:0,
   overrideAccess:true,draft:true,sort:"slug"});
  docs.push(...result.docs as unknown as Array<Record<string,unknown>>);
  if(!result.hasNextPage)break;
  if(page===10)throw Error("CMS inventory exceeds safe page limit");
 }
 const versions:Array<{id:string|number;records:unknown[]}>=[],inventory:CmsPageInventory[]=[];
 for(const doc of docs){
  const id=doc.id as string|number,slug=doc.slug as string;
  const records:unknown[]=[];let complete=false;
  for(let page=1;page<=20;page++){
   const result=await payload.findVersions({collection:"pages",
    where:{parent:{equals:id}},page,limit:100,depth:0,
    overrideAccess:true});
   records.push(...result.docs);
   if(!result.hasNextPage){complete=true;break}
  }
  const publishedVersion=records.some(record=>{
   const version=(record as {version?:{_status?:string}}).version;
   return version?._status==="published";
  });
  inventory.push({id,slug,title:String(doc.title||""),status:doc._status as string|undefined,
   hasPublishedVersion:publishedVersion,versionsComplete:complete});
  versions.push({id,records});
 }
 const decisions=planCmsPageCleanup(inventory);
 console.log(JSON.stringify({mode,scanned:decisions.length,
  keepOnline:decisions.filter(d=>d.action==="keep-online").map(d=>d.slug),
  removeUnpublished:decisions.filter(d=>d.action==="remove-unpublished").map(d=>d.slug),
  requireReview:decisions.filter(d=>d.action==="manual-review").map(d=>d.slug)},null,2));
 if(mode==="--apply"){
  if(decisions.some(d=>d.action==="manual-review"))
   throw Error("Uncertain CMS publishing status: refuse partial automatic deletion");
  const backupPath=path.join(archiveRoot,`draft-prune-${Date.now()}-${randomUUID()}.json`);
  const record={created:new Date().toISOString(),purpose:"CMS unpublished-only cleanup",
   decisions,documents:docs,versions};
  const original=Buffer.from(JSON.stringify(record,null,2),"utf8");
  const digest=cmsArchiveDigest(original);
  const handle=await open(backupPath,"wx",0o600);
  try{await handle.writeFile(original);await handle.sync()}
  finally{await handle.close()}
  // Verify the archive actually persisted correctly before any destructive step.
  // The archive must stay private: no symlink, no group/world read permission.
  const archiveInfo=await lstat(backupPath);
  const verifiedBytes=await readFile(backupPath);
  if(!archiveInfo.isFile()||archiveInfo.isSymbolicLink()||
   (archiveInfo.mode&0o077)!==0||archiveInfo.size!==original.length||
   !verifyCmsArchiveReadback(original,verifiedBytes))
   throw Error("CMS backup verification failed; no pages have been deleted");
  const saved=JSON.parse(verifiedBytes.toString("utf8")) as typeof record;
  if(saved.decisions.length!==decisions.length||
   saved.documents.length!==docs.length||
   saved.versions.length!==versions.length||
   cmsArchiveDigest(verifiedBytes)!==digest)
   throw Error("CMS backup manifest mismatch; no pages have been deleted");
  for(const decision of decisions){
   if(decision.action!=="remove-unpublished")continue;
   // Re-read just before deleting: no new draft may overwrite a published page.
   const current=await payload.findByID({collection:"pages",id:decision.id,
    draft:true,depth:0,overrideAccess:true});
   if(current.slug!==decision.slug||current._status!=="draft"||
    JSON.stringify(current)!==JSON.stringify(docs.find(d=>d.id===decision.id)))
    throw Error("CMS page changed during cleanup; stop and inspect backup");
   // A concurrent publication or new autosave can change history after inventory.
   // Never delete when fresh history differs from the backed-up version set.
   const recorded=versions.find(v=>v.id===decision.id);
   if(!recorded)throw Error("CMS versions are missing in verified backup");
   const fresh:unknown[]=[];
   let complete=false;
   for(let page=1;page<=20;page++){
    const history=await payload.findVersions({collection:"pages",
     where:{parent:{equals:decision.id}},page,limit:100,depth:0,overrideAccess:true});
    fresh.push(...history.docs);
    if(!history.hasNextPage){complete=true;break}
   }
   if(hasChangedCmsVersions(recorded.records,fresh,complete))
    throw Error("CMS page history changed during cleanup; stop and inspect backup");
   await payload.delete({collection:"pages",id:decision.id,overrideAccess:true});
  }
  console.log(JSON.stringify({removed:decisions.filter(d=>d.action==="remove-unpublished").length,
   archivePath:backupPath,keptPublished:decisions.filter(d=>d.action==="keep-online").length}));
 }
}finally{await payload.destroy()}
