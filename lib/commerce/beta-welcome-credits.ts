/** Historical Beta welcome credits remain spendable, but new Beta signup
 * awards are permanently retired in favour of the public launch promotion.
 */
export const BETA_WELCOME_CREDITS=250;
export function betaWelcomeCreditsEnabled(_env:Record<string,string|undefined>):boolean{return false;}
export function grantBetaWelcomeCredits(_db:unknown,_customerId:string):boolean{return false;}
