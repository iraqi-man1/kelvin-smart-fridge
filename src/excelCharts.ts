import { niceStep } from './Charts';
import { limitFor, metricInfo, shortTime } from './data';
import type { Forecast } from './forecast';
import type { Metric, Reading, Settings } from './types';

/**
 * Charts for the Excel export, drawn on a canvas and saved as PNG pictures in the workbook
 * (the Excel library used here cannot write native Excel charts). Always light, for printing.
 */
const W = 1100, H = 340, PAD = { l: 64, r: 24, t: 54, b: 44 };
const INK = '#161b22', MUTED = '#697281', GRID = '#e5e8ec', LIMIT = '#c92a2a';
const FONT = '"Segoe UI", Tahoma, Arial, sans-serif';

function canvas(w = W, h = H) {
  const c = document.createElement('canvas');
  const scale = 2; // sharp when zoomed or printed
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  return { c, g };
}
const png = (c: HTMLCanvasElement) => c.toDataURL('image/png');

function title(g: CanvasRenderingContext2D, text: string, sub: string, rtl: boolean, w = W) {
  g.direction = rtl ? 'rtl' : 'ltr';
  g.textAlign = rtl ? 'right' : 'left';
  const x = rtl ? w - PAD.r : PAD.l;
  g.fillStyle = INK; g.font = `600 17px ${FONT}`; g.fillText(text, x, 24);
  g.fillStyle = MUTED; g.font = `12.5px ${FONT}`; g.fillText(sub, x, 42);
  g.direction = 'ltr';
}

function yAxis(g: CanvasRenderingContext2D, lo: number, hi: number, w: number, h: number) {
  const step = niceStep(hi - lo || 1, 4);
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step || step;
  const y = (v: number) => h - PAD.b - (v - min) / (max - min || 1) * (h - PAD.t - PAD.b);
  g.font = `11.5px ${FONT}`; g.textAlign = 'right'; g.fillStyle = MUTED; g.strokeStyle = GRID; g.lineWidth = 1;
  for (let v = min; v <= max + step / 2; v += step) {
    g.beginPath(); g.moveTo(PAD.l, y(v)); g.lineTo(w - PAD.r, y(v)); g.stroke();
    g.fillText(String(+v.toFixed(2)), PAD.l - 8, y(v) + 4);
  }
  return y;
}

/** A sensor over the exported time, with its alert limit and (optionally) the forecast after it. */
export function readingChart(data: Reading[], metric: Metric, settings: Settings, labels: { title: string; sub: string; limit: string; forecast: string }, rtl: boolean, fc?: Forecast | null) {
  const { c, g } = canvas();
  title(g, labels.title, labels.sub, rtl);
  if (data.length < 2) return png(c);
  const color = metricInfo[metric].color, limit = limitFor(metric, settings);
  const start = data[0].timestamp, end = fc?.points.at(-1)?.t ?? data.at(-1)!.timestamp;
  const values = [...data.map(r => r[metric]), limit, ...(fc ? fc.points.flatMap(p => [p.lo, p.hi]) : [])];
  const y = yAxis(g, Math.min(...values), Math.max(...values), W, H);
  const x = (t: number) => PAD.l + (t - start) / (end - start || 1) * (W - PAD.l - PAD.r);

  // Time axis: about 6 labels.
  g.fillStyle = MUTED; g.textAlign = 'center'; g.font = `11.5px ${FONT}`;
  for (let i = 0; i <= 6; i++) { const t = start + (end - start) * i / 6; g.fillText(shortTime(t), x(t), H - PAD.b + 18); }

  if (fc) {
    const now = data.at(-1)!.timestamp;
    g.fillStyle = '#f3f5f8'; g.fillRect(x(now), PAD.t - 6, W - PAD.r - x(now), H - PAD.t - PAD.b + 6);
    g.fillStyle = MUTED; g.textAlign = 'center'; g.font = `600 11.5px ${FONT}`; g.fillText(labels.forecast, (x(now) + W - PAD.r) / 2, PAD.t + 6);
    g.beginPath();
    fc.points.forEach((p, i) => (i ? g.lineTo(x(p.t), y(p.hi)) : g.moveTo(x(p.t), y(p.hi))));
    fc.points.slice().reverse().forEach(p => g.lineTo(x(p.t), y(p.lo)));
    g.closePath(); g.globalAlpha = 0.15; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    g.setLineDash([6, 5]); g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath(); fc.points.forEach((p, i) => (i ? g.lineTo(x(p.t), y(p.v)) : g.moveTo(x(p.t), y(p.v)))); g.stroke(); g.setLineDash([]);
  }

  // Limit line.
  g.setLineDash([5, 4]); g.strokeStyle = LIMIT; g.lineWidth = 1.25;
  g.beginPath(); g.moveTo(PAD.l, y(limit)); g.lineTo(W - PAD.r, y(limit)); g.stroke(); g.setLineDash([]);
  g.fillStyle = LIMIT; g.textAlign = 'left'; g.font = `600 11px ${FONT}`; g.fillText(`${labels.limit} ${limit}`, PAD.l + 6, y(limit) - 5);

  // The readings, broken where the device was silent for over 10 minutes.
  g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
  data.forEach((r, i) => (i && r.timestamp - data[i - 1].timestamp < 600000 ? g.lineTo(x(r.timestamp), y(r[metric])) : g.moveTo(x(r.timestamp), y(r[metric]))));
  g.stroke();
  return png(c);
}

/** Bars: energy in each clock hour. */
export function hourlyChart(hours: { start: number; wh: number }[], labels: { title: string; sub: string }, rtl: boolean) {
  const { c, g } = canvas();
  title(g, labels.title, labels.sub, rtl);
  const y = yAxis(g, 0, Math.max(...hours.map(h => h.wh), 0.01), W, H);
  const slot = (W - PAD.l - PAD.r) / hours.length;
  hours.forEach((h, i) => {
    const x0 = PAD.l + i * slot + slot * 0.15, bw = slot * 0.7;
    g.fillStyle = '#e8590c'; g.fillRect(x0, y(h.wh), bw, H - PAD.b - y(h.wh));
    if (i % 3 === 0) { g.fillStyle = MUTED; g.textAlign = 'center'; g.font = `11px ${FONT}`; g.fillText(shortTime(h.start), x0 + bw / 2, H - PAD.b + 18); }
  });
  return png(c);
}

/** Horizontal bars: each part's share of the energy. */
export function partsChart(rows: { name: string; wh: number; color: string }[], labels: { title: string; sub: string }, rtl: boolean) {
  const h = PAD.t + rows.length * 34 + 20;
  const { c, g } = canvas(W, h);
  title(g, labels.title, labels.sub, rtl);
  const total = rows.reduce((s, r) => s + r.wh, 0) || 1, max = Math.max(...rows.map(r => r.wh), 0.0001);
  const nameW = 230, barW = W - PAD.r - PAD.l - nameW - 120;
  rows.forEach((r, i) => {
    const yy = PAD.t + 6 + i * 34;
    g.fillStyle = INK; g.font = `13px ${FONT}`; g.textAlign = 'left'; g.direction = rtl ? 'rtl' : 'ltr';
    g.textAlign = rtl ? 'right' : 'left';
    g.fillText(r.name, rtl ? PAD.l + nameW - 10 : PAD.l, yy + 15);
    g.direction = 'ltr';
    g.fillStyle = r.color; g.fillRect(PAD.l + nameW, yy + 3, Math.max(2, r.wh / max * barW), 18);
    g.fillStyle = MUTED; g.textAlign = 'left'; g.font = `12px ${FONT}`;
    g.fillText(`${r.wh.toFixed(2)} Wh · ${(r.wh / total * 100).toFixed(0)}%`, PAD.l + nameW + Math.max(2, r.wh / max * barW) + 8, yy + 16);
  });
  return png(c);
}
