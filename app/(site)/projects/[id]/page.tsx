import {permanentRedirect} from "next/navigation";

/** Existing private video links remain valid and keep their project ID. */
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 permanentRedirect("/videos/"+encodeURIComponent(id));
}
