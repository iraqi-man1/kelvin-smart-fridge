import { limitFor, READING_EVERY } from './data';
import type { Metric, Reading, Settings } from './types';

/**
 * What a sensor will probably read next: a straight-line trend fitted (least squares) to the
 * most recent readings, with a 95% prediction band that widens the further ahead it looks.
 * It is a short-term guide, not a promise: it assumes the recent trend carries on.
 */
export type ForecastPoint = { t: number; v: number; lo: number; hi: number };
export type Forecast = { points: ForecastPoint[]; slopePerHour: number; crossesAt: number | null; reliable: boolean };

// What each sensor can physically report, so a forecast never shows impossible values.
const RANGE: Record<Metric, [number, number]> = { temperature: [-40, 125], humidity: [0, 100], eco2: [400, 8192], tvoc: [0, 1187] };
// Readings come every 1 h 30 min; a longer gap means the device was off.
const GAP = READING_EVERY + 15 * 60000;

/** How far ahead to look for each chart period (24 h → 6 h, 3 days → 12 h, 7 days → 24 h). */
export const horizonFor = (periodHours: number) => (periodHours <= 24 ? 6 : periodHours <= 72 ? 12 : 24) * 3600000;

export function forecast(readings: Reading[], metric: Metric, horizon: number, settings: Settings, steps = 36): Forecast | null {
  if (readings.length < 6) return null;
  const end = readings.at(-1)!.timestamp;
  // Learn from the last stretch without gaps, about twice as long as we look ahead.
  let from = readings.length - 1;
  while (from > 0 && end - readings[from - 1].timestamp <= horizon * 2 && readings[from].timestamp - readings[from - 1].timestamp <= GAP) from--;
  const sample = readings.slice(from);
  if (sample.length < 6) return null;

  // Least squares on (minutes before the last reading, value).
  const xs = sample.map(r => (r.timestamp - end) / 60000), ys = sample.map(r => r[metric]);
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return null;
  let slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));
  // A trend that is not clearly different from noise is treated as flat.
  const slopeError = sigma / Math.sqrt(sxx);
  if (Math.abs(slope) < slopeError) slope = 0;
  const level = slope === 0 ? my : intercept;

  const [lo, hi] = RANGE[metric];
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  const z = 1.96;
  const points: ForecastPoint[] = [];
  // The curve leaves from the last reading itself and eases into the trend line (the gap
  // between them fades with a time constant of a quarter of the horizon), so there is no
  // jump at "now". The band starts closed and opens as the forecast looks further ahead.
  const last = ys.at(-1)!;
  const offset = last - level;
  const tau = horizon / 60000 / 4;
  for (let k = 0; k <= steps; k++) {
    const minutes = horizon / 60000 * k / steps;
    const ease = Math.exp(-minutes / tau);
    const v = level + slope * minutes + offset * ease;
    // Prediction interval of a fitted line: grows with distance from the data's centre.
    const spread = z * sigma * Math.sqrt(1 + 1 / n + (minutes - mx) ** 2 / sxx) * (1 - ease);
    points.push({ t: end + minutes * 60000, v: clamp(v), lo: clamp(v - spread), hi: clamp(v + spread) });
  }
  const limit = limitFor(metric, settings);
  const now = last;
  const cross = now <= limit ? points.find(p => p.v > limit) : undefined;
  return {
    points, slopePerHour: slope * 60, crossesAt: cross ? cross.t : null,
    // Few points or a band wider than the values themselves: show it, but say it is rough.
    reliable: n >= 12 && sigma * z < Math.max(1, Math.abs(my) * 0.25),
  };
}

/** The forecast value at a time inside the forecast (straight between its close points). */
export function forecastAt(f: Forecast, t: number): ForecastPoint | null {
  const p = f.points;
  if (t < p[0].t || t > p.at(-1)!.t) return null;
  const i = Math.max(1, p.findIndex(q => q.t >= t));
  const a = p[i - 1], b = p[i], k = (t - a.t) / (b.t - a.t || 1);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { t, v: mix(a.v, b.v), lo: mix(a.lo, b.lo), hi: mix(a.hi, b.hi) };
}

/** A smooth SVG path through points (Catmull-Rom turned into cubic Bézier curves). */
export function smoothPath(pts: [number, number][], move = true) {
  if (!pts.length) return '';
  let d = `${move ? 'M' : 'L'}${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
