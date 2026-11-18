
/** Viewport-only audio navigation. It never modifies the selected audio cut. */
export type WaveViewport={start:number;span:number};
export function boundWaveViewport(start:number,span:number,duration:number):WaveViewport{
 const maxDuration=Math.max(0.001,Number.isFinite(duration)?duration:0.001);
 const boundedSpan=Math.max(0.001,Math.min(maxDuration,Number.isFinite(span)?span:maxDuration));
 return {start:Math.max(0,Math.min(maxDuration-boundedSpan,Number.isFinite(start)?start:0)),span:boundedSpan};
}
/** Swiping right reveals earlier source audio while keeping the trim unchanged. */
export function panWaveViewport(origin:WaveViewport,deltaX:number,stripWidth:number,duration:number):WaveViewport{
 if(!Number.isFinite(stripWidth)||stripWidth<=0||!Number.isFinite(deltaX))
  return boundWaveViewport(origin.start,origin.span,duration);
 return boundWaveViewport(origin.start-(deltaX/stripWidth)*origin.span,origin.span,duration);
}
/** Pinch around the point in the source beneath the two fingers.
 * Increasing the distance zooms in, and the visible window stays bounded.
 */
export function pinchWaveViewport(
 origin:WaveViewport,initialDistance:number,currentDistance:number,
 anchorSeconds:number,midpointFraction:number,minSpan:number,duration:number
):WaveViewport{
 if(!Number.isFinite(initialDistance)||initialDistance<=0||
    !Number.isFinite(currentDistance)||currentDistance<=0)
  return boundWaveViewport(origin.start,origin.span,duration);
 const min=Math.max(0.001,Math.min(duration,minSpan));
 const span=Math.max(min,Math.min(duration,origin.span*initialDistance/currentDistance));
 const midpoint=Math.max(0,Math.min(1,midpointFraction));
 return boundWaveViewport(anchorSeconds-midpoint*span,span,duration);
}
