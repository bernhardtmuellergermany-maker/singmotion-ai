import {permanentRedirect} from "next/navigation";

/** Preserve historical links and bookmarks with a permanent redirect. */
export default function Page(){
 permanentRedirect("/videos");
}
