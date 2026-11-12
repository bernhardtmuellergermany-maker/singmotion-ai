/**
 * Customer-facing prepaid credit tariff preview.
 * 25 Credits per STARTED second of the original audio excerpt; no tempo
 * slow-down, provider output-duration uplift or internal provider cost markup.
 * Server-side generation settlement remains independently gated.
 */
export const VIDEO_CREDITS_PER_STARTED_SECOND=25;

export type VideoCreditQuote={
 sourceSeconds:number;
 startedSeconds:number;
 credits:number;
};

/** Source timestamps in Studio are rounded to the nearest millisecond. */
export function quoteVideoCredits(start:number,end:number):VideoCreditQuote|null {
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return null;
 const startMs=Math.round(start*1000),endMs=Math.round(end*1000);
 const selectionMs=endMs-startMs;
 if(!Number.isSafeInteger(selectionMs)||selectionMs<5000||selectionMs>300000)return null;
 const startedSeconds=Math.ceil(selectionMs/1000);
 return {sourceSeconds:selectionMs/1000,startedSeconds,
  credits:startedSeconds*VIDEO_CREDITS_PER_STARTED_SECOND};
}
