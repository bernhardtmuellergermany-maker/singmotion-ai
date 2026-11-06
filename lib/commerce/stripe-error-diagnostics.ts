/** Stripe may return raw descriptions that contain customer information.
 * Only return structured, bounded, known-safe error identifiers.
 * No Stripe keys, customer emails, order IDs or request payloads are logged. */
const safeIdentifier=(value:unknown,max:number):string|null=>
 typeof value==="string"&&value.length<=max&&/^[a-zA-Z0-9_]+$/.test(value)?value:null;
const safeParameter=(value:unknown):string|null=>
 typeof value==="string"&&value.length<=100&&/^[a-zA-Z0-9_\[\]]+$/.test(value)?value:null;

export function sanitizedStripeCheckoutError(body:unknown):{
 type:string|null;code:string|null;param:string|null;
}{
 if(!body||typeof body!=="object")return {type:null,code:null,param:null};
 const outer=body as {error?:unknown};
 const error=outer.error;
 if(!error||typeof error!=="object")return {type:null,code:null,param:null};
 const e=error as {type?:unknown;code?:unknown;param?:unknown};
 return {
  type:safeIdentifier(e.type,60),
  code:safeIdentifier(e.code,80),
  param:safeParameter(e.param),
 };
}
