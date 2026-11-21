import type {DatabaseSync} from "node:sqlite";
export const MAX_SAMPLE_BYTES=50*1024*1024;
export const MAX_LIBRARY_BYTES=256*1024*1024;
export const MAX_SAMPLES=100;
export type AudioTip={id:string;headline:string;description:string;emoji:string;sortOrder:number;active:number;filename:string;mime:string;size:number};
export const validTipId=(id:string)=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
export function ensureAudioTips(db:DatabaseSync){
 db.exec("CREATE TABLE IF NOT EXISTS cms_audio_quick_tips (id TEXT PRIMARY KEY,headline TEXT NOT NULL,description TEXT NOT NULL,emoji TEXT NOT NULL,sort_order INTEGER NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,audio BLOB NOT NULL)");
}
export function listAudioTips(db:DatabaseSync,manage=false):AudioTip[]{
 ensureAudioTips(db);
 return db.prepare("SELECT id,headline,description,emoji,sort_order AS sortOrder,active,filename,mime,size FROM cms_audio_quick_tips"+(manage?"":" WHERE active=1")+" ORDER BY sort_order,headline,id").all() as AudioTip[];
}
export function audioMime(filename:string,bytes:Uint8Array):string|null{
 if(!bytes.length||bytes.length>MAX_SAMPLE_BYTES)return null;
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(/\.mp3$/i.test(filename)&&(b.toString("ascii",0,3)==="ID3"||(b[0]===255&&(b[1]&224)===224)))return "audio/mpeg";
 if(/\.wav$/i.test(filename)&&b.toString("ascii",0,4)==="RIFF"&&b.toString("ascii",8,12)==="WAVE")return "audio/wav";
 if(/\.m4a$/i.test(filename)&&b.toString("ascii",4,8)==="ftyp")return "audio/mp4";
 return null;
}
export function sampleFilename(headline:string,mime:string){
 const stem=headline.replace(/[^\p{L}\p{N} _-]/gu,"").trim().slice(0,80)||"Audio sample";
 return stem+(mime==="audio/mpeg"?".mp3":mime==="audio/wav"?".wav":".m4a");
}
