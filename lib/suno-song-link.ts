/** A Suno share page is a pointer, NOT an authorized audio download.
 * Never fetch, scrape or resolve the remote page or CDN. The song owner uses
 * Suno's official Download action and chooses that file in SingMotion.
 */
export function normalizeSunoSongLink(raw:string):string|null{
  if(typeof raw!=="string"||raw.length>500)return null;
  const trimmed=raw.trim();
  if(!trimmed)return null;
  try{
    const u=new URL(trimmed);
    if(u.protocol!=="https:"||u.username||u.password||
      !["suno.com","www.suno.com"].includes(u.hostname)||u.port)return null;
    const short=/^\/s\/([A-Za-z0-9_-]{8,80})\/?$/.exec(u.pathname);
    if(short)return "https://suno.com/s/"+short[1];
    const song=/^\/song\/([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})\/?$/.exec(u.pathname);
    if(song)return "https://suno.com/song/"+song[1].toLowerCase();
    return null;
  }catch{return null;}
}
