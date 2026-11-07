/** Stripe may return raw descriptions that contain customer information.
 * Never log or forward the raw Stripe error message, client information,
 * credentials or request payloads. Match only fixed diagnostic categories. */
const safeIdentifier=(value:unknown,max:number):string|null=>
 typeof value==="string"&&value.length<=max&&/^[a-zA-Z0-9_]+$/.test(value)?value:null;
const safeParameter=(value:unknown):string|null=>
 typeof value==="string"&&value.length<=100&&/^[a-zA-Z0-9_\[\]]+$/.test(value)?value:null;

export type StripeCheckoutFailureCategory=
 "account_not_ready"|"payment_method_unavailable"|"tax_configuration"|
 "checkout_urls"|"missing_parameter"|"invalid_customer_email"|
 "line_item"|"amount_or_currency"|"api_configuration"|"unclassified";

function categorizeStripeError(message:unknown,param:string|null):StripeCheckoutFailureCategory{
 // Classification must not output any part of the original message.
 if(typeof message!=="string"||message.length>4000)return "unclassified";
 const m=message.toLowerCase();
 if(/(activate your account|account (?:is |isn't |is not |has not |must be |needs to be ).*(?:activat|verif|onboard|complete)|account.*(restricted|capabilit|not enabled)|business profile|business name|account setup)/.test(m))
  return "account_not_ready";
 if(/(payment method|payment_methods|payment_method_types|card payments|capability).*(not available|not enabled|unavailable|disabled|not supported|not configured)/.test(m))
  return "payment_method_unavailable";
 if(/(tax_behavior|tax rates|tax rate|automatic_tax|tax configuration|tax settings|tax code)/.test(m))
  return "tax_configuration";
 if(/(success_url|cancel_url|return_url|url.*(invalid|must|https))/.test(m))
  return "checkout_urls";
 if(/(missing required|must provide|is required|not provided|required parameter)/.test(m))
  return "missing_parameter";
 if(/(customer_email|email address|invalid email)/.test(m))
  return "invalid_customer_email";
 if(/(line_items|price_data|product_data|price |line item|quantity)/.test(m))
  return "line_item";
 if(/(currency|minimum charge|amount|unit_amount|minimum amount|payment amount)/.test(m))
  return "amount_or_currency";
 if(/(api version|api key|invalid_request_error|checkout session|checkout mode)/.test(m))
  return "api_configuration";
 // Stripe can omit message codes entirely; avoid claiming a root cause.
 if(param?.startsWith("line_items"))return "line_item";
 if(param?.includes("tax"))return "tax_configuration";
 return "unclassified";
}

export function sanitizedStripeCheckoutError(body:unknown):{
 type:string|null;code:string|null;param:string|null;
 category:StripeCheckoutFailureCategory;
}{
 if(!body||typeof body!=="object")return {type:null,code:null,param:null,category:"unclassified"};
 const outer=body as {error?:unknown};
 const error=outer.error;
 if(!error||typeof error!=="object")return {type:null,code:null,param:null,category:"unclassified"};
 const e=error as {type?:unknown;code?:unknown;param?:unknown;message?:unknown};
 const param=safeParameter(e.param);
 return {
  type:safeIdentifier(e.type,60),
  code:safeIdentifier(e.code,80),
  param,
  category:categorizeStripeError(e.message,param),
 };
}
