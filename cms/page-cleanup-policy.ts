/** Pure, fail-closed CMS cleanup policy.
 * A page that is currently published OR has ever had a published version
 * remains in CMS, even when its latest autosave is a draft.
 */
import {pageSlugs} from "./policy.ts";
export type CmsPageInventory={
 id:string|number;slug:string;title:string;status:string|undefined;
 hasPublishedVersion:boolean;versionsComplete:boolean;
};
export type CmsPageDecision=CmsPageInventory & {
 action:"keep-online"|"remove-unpublished"|"manual-review";reason:string;
};
export function planCmsPageCleanup(items:CmsPageInventory[]):CmsPageDecision[]{
 const slugs=new Set<string>(),ids=new Set<string>();
 return items.map(page=>{
  const identity=String(page.id);
  const known=pageSlugs.includes(page.slug) &&
   (typeof page.id==="number"?Number.isSafeInteger(page.id)&&page.id>0:
    typeof page.id==="string"&&page.id.length>0&&page.id.length<128);
  if(!known||slugs.has(page.slug)||ids.has(identity)||
   typeof page.title!=="string"||!page.title.trim())
   throw Error("CMS cleanup inventory contains an unknown or duplicate page");
  slugs.add(page.slug);ids.add(identity);
  if(page.status==="published"||page.hasPublishedVersion)
   return {...page,action:"keep-online" as const,reason:"published content or prior live version"};
  if(!page.versionsComplete||page.status!=="draft")
   return {...page,action:"manual-review" as const,reason:"unknown publishing history"};
  return {...page,action:"remove-unpublished" as const,reason:"draft-only page never published"};
 });
}
