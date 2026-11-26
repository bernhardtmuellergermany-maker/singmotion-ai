import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {probe} from "../media.ts";
import {pcmWaveform,WAVEFORM_SAMPLE_RATE,type MediaWaveform} from "./waveform.ts";

/** Decode only the first audio stream, retaining its media-relative start and silence. */
export async function extractMediaWaveform(file:string,durationMs:number):Promise<MediaWaveform>{
 if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>7200000)throw Error("Invalid waveform duration");
 const media=await probe(file);
 if(!media.streams.some(s=>s.codec_type==="audio"))return {durationMs,peaks:[],hasAudio:false};
 const {stdout}=await promisify(execFile)("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-threads","1","-i",file,"-map","0:a:0","-vn","-sn","-dn","-ac","1","-af","aresample="+WAVEFORM_SAMPLE_RATE+":async=1:first_pts=0","-ar",String(WAVEFORM_SAMPLE_RATE),"-t",String(durationMs/1000),"-f","s16le","pipe:1"],{encoding:"buffer",timeout:45000,maxBuffer:32*1024*1024});
 return pcmWaveform(stdout,durationMs);
}
