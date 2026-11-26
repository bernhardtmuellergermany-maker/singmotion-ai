/** Keep the mobile proxy hardware-decodable at 720p, without upscaling. */
export const mobilePreviewVersion="singmotion-project-mobile-720-v2";
export const previewByteLimit=(mobile:boolean)=> (mobile?64:24)*1024*1024;
export function projectPreviewArgs(input:string,output:string,mobile:boolean):string[]{
 const scale=mobile
  ?"scale=w='min(iw,if(gte(iw,ih),1280,720))':h='min(ih,if(gte(iw,ih),720,1280))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30"
  :"scale=w='min(854,iw)':h='min(854,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
 return ["-nostdin","-hide_banner","-loglevel","error","-threads","1","-i",input,
  "-map","0:v:0","-map","0:a:0?","-sn","-dn","-filter_threads","1","-vf",scale,
  "-c:v","libx264","-threads","1","-preset","veryfast","-crf",mobile?"21":"24",
  "-maxrate",mobile?"2200k":"800k","-bufsize",mobile?"4400k":"1600k",
  "-g",mobile?"15":"30",...(mobile?["-profile:v","baseline","-level:v","3.1"]:[]),
  "-pix_fmt","yuv420p","-c:a","aac","-b:a",mobile?"192k":"96k","-movflags","+faststart",output];
}
