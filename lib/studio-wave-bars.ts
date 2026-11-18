/**
 * Stable Studio waveform sampling: amplitude columns are anchored to absolute
 * audio time, not to the left edge of the changing viewport. Panning translates
 * the existing bars without changing their height or their color.
 */
export type WaveBar = {
  index: number;
  height: number;
  selected: boolean;
};
export type AnchoredWaveBars = {
  bars: WaveBar[];
  trackWidth: number;
  translateX: number;
  barCount: number;
};

const OVERSCAN_BARS = 3;

export function anchoredWaveBars(
  peaks: readonly number[],
  duration: number,
  viewStart: number,
  viewSpan: number,
  stripWidth: number,
  selectedStart: number,
  selectedEnd: number,
): AnchoredWaveBars {
  const safeWidth = Math.max(1, stripWidth || 360);
  const columns = Math.max(44, Math.min(170, Math.round(safeWidth / 5.6)));
  const span = Math.max(0.001, viewSpan);
  const secondsPerBar = span / columns;
  const pixelStep = safeWidth / columns;
  const indexAtStart = Math.floor(viewStart / secondsPerBar);
  const firstIndex = indexAtStart - OVERSCAN_BARS;
  const barCount = columns + 2 * OVERSCAN_BARS;
  const translateX = (firstIndex - viewStart / secondsPerBar) * pixelStep;
  const validAudio = Number.isFinite(duration) && duration > 0;

  const bars = Array.from({length: barCount}, (_, n) => {
    const index = firstIndex + n;
    const binStart = index * secondsPerBar;
    const binEnd = binStart + secondsPerBar;
    const midpoint = binStart + secondsPerBar / 2;
    const inAudio = validAudio && binEnd > 0 && binStart < duration;
    let amplitude = peaks.length === 0 ? 0.08 : 0;
    if (inAudio && peaks.length > 0) {
      const from = Math.max(0, Math.min(peaks.length - 1,
        Math.floor((Math.max(0,binStart) / duration) * peaks.length)));
      const to = Math.min(peaks.length, Math.max(from + 1,
        Math.ceil((Math.min(duration,binEnd) / duration) * peaks.length)));
      for (let k=from; k<to; k++) {
        if (peaks[k]>amplitude) amplitude=peaks[k];
      }
    }
    return {
      index,
      height: inAudio ? Math.max(5, amplitude*92) : 0,
      selected: midpoint >= selectedStart && midpoint <= selectedEnd,
    };
  });
  return {bars, trackWidth: barCount * pixelStep, translateX, barCount};
}
