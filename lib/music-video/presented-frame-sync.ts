/** Browser presentation timestamps are distinct from HTMLMediaElement.currentTime.
 * A currentTime read can advance while the compositor is still displaying an
 * older frame. Only Lip-Sync picture follows this tighter presentation gate. */
export type PresentedFrame={mediaTime:number;displayTime:number;observedAt:number};
export const LIP_SYNC_START_GRACE_MS=180;
export const LIP_SYNC_FRAME_LAG_SECONDS=.085;
export const LIP_SYNC_FRAME_AHEAD_SECONDS=.075;
export const LIP_SYNC_FRAME_PERSIST_MS=100;
export function presentedFrameError(expected:number,frame:PresentedFrame,now:number,masterRunning:boolean){
 if(!Number.isFinite(expected)||!Number.isFinite(frame.mediaTime)||!Number.isFinite(frame.displayTime)||!Number.isFinite(now))return null;
 // requestVideoFrameCallback can arrive just before the frame's expected
 // display; account for that scheduling interval, not an arbitrary offset.
 const untilDisplay=masterRunning?Math.max(0,Math.min(.05,(frame.displayTime-now)/1000)):0;
 return expected+untilDisplay-frame.mediaTime;
}
export function lipSyncFrameDecision(expected:number,actual:number,frame:PresentedFrame|null,now:number,startAge:number,masterRunning:boolean){
 const clockError=expected-actual;
 const frameError=frame?presentedFrameError(expected,frame,now,masterRunning):null;
 if(!Number.isFinite(clockError))return {outOfSync:false,rate:1};
 const clockBad=Math.abs(clockError)>(startAge<LIP_SYNC_START_GRACE_MS?.15:.085);
 const frameBad=frameError!==null&&(frameError>LIP_SYNC_FRAME_LAG_SECONDS||frameError< -LIP_SYNC_FRAME_AHEAD_SECONDS);
 // A frame is discrete (typically 24–30fps). Do not try to eliminate normal
 // frame quantization by constantly changing the native playback rate.
 const error=clockError;
 const rate=Math.abs(error)<=.018?1:Math.round(Math.max(.94,Math.min(1.06,1+error*1.5))*100)/100;
 return {outOfSync:clockBad||startAge>=LIP_SYNC_START_GRACE_MS&&frameBad,rate};
}
