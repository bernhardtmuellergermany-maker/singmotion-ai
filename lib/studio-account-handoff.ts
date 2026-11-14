/** Safe cross-account handoff for a guest's *own* Step 4 draft.
 * This is only a navigation hint, never authorization for paid work.
 * Media ownership must be proved separately with the HttpOnly guest cookie.
 */
const id=/^[A-Za-z0-9_-]{1,80}$/;
export type StudioAccountReturn={draftId:string;requiredCredits:number};
export function studioAccountReturn(draftId:string,requiredCredits:number):string|null{
 if(!id.test(draftId)||!Number.isSafeInteger(requiredCredits)||
    requiredCredits<1||requiredCredits>7500)return null;
 return "/studio/continue?draft="+encodeURIComponent(draftId)+"&requiredCredits="+requiredCredits;
}
export function parseStudioAccountReturn(raw:string|null):StudioAccountReturn|null{
 if(!raw||raw.length>260||!raw.startsWith("/")||raw.startsWith("//")||
    raw.includes("#")||raw.includes("%2f")||raw.includes("%2F"))return null;
 try{
  const parsed=new URL(raw,"https://www.singmotion.ai");
  const draftId=parsed.searchParams.get("draft")||"";
  const requiredCredits=Number(parsed.searchParams.get("requiredCredits"));
  if(parsed.pathname!=="/studio/continue"||parsed.searchParams.size!==2)return null;
  const canonical=studioAccountReturn(draftId,requiredCredits);
  return canonical===raw?{draftId,requiredCredits}:null;
 }catch{return null}
}
export const STUDIO_ACCOUNT_RESUME_KEY="sm-studio-account-resume";
