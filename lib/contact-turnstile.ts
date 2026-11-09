/** A valid token from another Turnstile widget on the same host must not
 * authorize a support message. Cloudflare's siteverify response is trusted
 * only after the configured hostname AND this form's action match. */
export const CONTACT_TURNSTILE_ACTION="singmotion_contact";
export function contactTurnstileAccepted(value:unknown,hosts:readonly string[]):boolean{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const result=value as {success?:unknown;hostname?:unknown;action?:unknown};
 return result.success===true&&typeof result.hostname==="string"&&
  hosts.includes(result.hostname)&&result.action===CONTACT_TURNSTILE_ACTION;
}
