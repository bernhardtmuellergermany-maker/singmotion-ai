import {redirect} from "next/navigation";
// Legacy demonstration settings are not a customer account page.
// Preserve the URL but take customers to their real account settings.
export default function Page(){redirect("/account/settings");}
