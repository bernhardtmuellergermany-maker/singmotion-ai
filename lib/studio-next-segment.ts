import {MAX_VIDEO_SELECTION_SECONDS,validateSelection} from "./domain.ts";
import type {StudioDraftExport} from "./studio-draft.ts";

/** The immutable input selection, not the provider's rendered duration,
 * defines the next cut. Keep the exact source endpoint (no rounding). */
export function nextStudioAudioSelection(previous:StudioDraftExport,duration:number|null):StudioDraftExport|null{
 if(typeof duration!=="number"||!Number.isFinite(duration)||
    !Number.isFinite(previous.start)||!Number.isFinite(previous.end)||
    previous.start<0||previous.end<=previous.start||duration-previous.end<5)return null;
 const start=previous.end;
 const length=Math.min(MAX_VIDEO_SELECTION_SECONDS,Math.max(5,previous.end-previous.start));
 const end=Math.min(duration,start+length);
 // Avoid floating-point subtraction exceeding the validated maximum.
 const boundedEnd=end-start>MAX_VIDEO_SELECTION_SECONDS?end-0.000000001:end;
 validateSelection(start,boundedEnd,duration);
 return {version:1,owner:previous.owner,songId:previous.songId,imageId:"",
  start,end:boundedEnd,performance:"Natural",camera:"Static camera",customPrompt:"",
  ...(previous.outputFormat?{outputFormat:previous.outputFormat,formatMode:previous.outputFormat}:{})};
}
