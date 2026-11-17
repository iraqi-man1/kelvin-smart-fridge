import { isAlert } from './data';
import type { Reading, Settings } from './types';

/**
 * How each part draws current:
 * - always:  the whole time the system is on.
 * - reading: a burst of `seconds` for every reading the device sends.
 * - alert:   while the latest reading is over a limit, for `duty` of that time.
 */
export type Part = { id: string; kind: 'always' | 'reading' | 'alert'; mA: number; seconds?: number; duty?: number };

// Typical figures from each part's datasheet (names, roles and sources are in i18n.ts).
// Every 3.3 V part runs through the DevKit's linear regulator, so it pulls the same
// current from the 5 V input.
export const parts: Part[] = [
  { id: 'esp32', kind: 'always', mA: 50 },
  { id: 'wifi', kind: 'reading', mA: 120, seconds: 0.5 },
  { id: 'board', kind: 'always', mA: 28 },
  { id: 'dht11', kind: 'always', mA: 2.6 },
  { id: 'ccs811', kind: 'always', mA: 14 },
  { id: 'oled', kind: 'always', mA: 10 },
  { id: 'led', kind: 'alert', mA: 5.9, duty: 1 },
  { id: 'buzzer', kind: 'alert', mA: 30, duty: 0.5 },
];

// Readings further apart than this mean the system was off or offline.
const GAP = 10 * 60000;

export type Usage = { hours: number; sends: number; alertHours: number; mAh: Record<string, number> };

/** Charge each enabled part drew between two times, from the readings the device sent. */
export function usageBetween(readings: Reading[], from: number, to: number, settings: Settings): Usage {
  const enabled = parts.filter(p => settings.parts.includes(p.id));
  const mAh: Record<string, number> = Object.fromEntries(enabled.map(p => [p.id, 0]));
  let on = 0, alertMs = 0, sends = 0;
  for (let i = 0; i < readings.length; i++) {
    const b = readings[i];
    if (b.timestamp > from && b.timestamp <= to) sends++;
    if (!i) continue;
    const a = readings[i - 1];
    if (b.timestamp <= from || a.timestamp >= to || b.timestamp - a.timestamp > GAP) continue;
    const ms = Math.min(b.timestamp, to) - Math.max(a.timestamp, from);
    if (ms <= 0) continue;
    on += ms;
    if (isAlert(a, settings)) alertMs += ms;
  }
  for (const p of enabled) {
    mAh[p.id] = p.kind === 'always' ? p.mA * on / 3600000
      : p.kind === 'alert' ? p.mA * (p.duty ?? 1) * alertMs / 3600000
      : p.mA * (p.seconds ?? 0) * sends / 3600;
  }
  return { hours: on / 3600000, sends, alertHours: alertMs / 3600000, mAh };
}

export const totalWh = (u: Usage, volts: number) => Object.values(u.mAh).reduce((s, v) => s + v, 0) * volts / 1000;

/** Typical seconds between readings, from the last few the device sent. */
export function sendInterval(readings: Reading[]) {
  const gaps = readings.slice(-21).map((r, i, all) => i ? r.timestamp - all[i - 1].timestamp : 0).slice(1).filter(g => g > 0 && g <= GAP).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] / 1000 : undefined;
}

/** Current each part draws right now, averaged over one send interval. */
export function currentNow(latest: Reading | undefined, interval: number, settings: Settings) {
  const alert = latest ? isAlert(latest, settings) : false;
  return parts.filter(p => settings.parts.includes(p.id)).map(p => ({
    part: p,
    mA: p.kind === 'always' ? p.mA : p.kind === 'alert' ? (alert ? p.mA * (p.duty ?? 1) : 0) : p.mA * (p.seconds ?? 0) / interval,
  }));
}

/** Wh per clock hour for the last `count` hours, oldest first. */
export function hourlyWh(readings: Reading[], now: number, settings: Settings, count = 24) {
  const hour = new Date(now); hour.setMinutes(0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const start = hour.getTime() - (count - 1 - i) * 3600000;
    const u = usageBetween(readings, start, Math.min(start + 3600000, now), settings);
    return { start, current: i === count - 1, wh: totalWh(u, settings.supplyVoltage), hours: u.hours };
  });
}
