import {redirect} from "next/navigation";
/** Backward-compatible URL. Usage now lives within Credits. */
export default function UsagePage(){redirect("/credits#usage");}
