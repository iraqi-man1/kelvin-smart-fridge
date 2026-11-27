import type { Currency, Lang, Metric, Reading, Settings } from './types';

export const metrics: Metric[] = ['temperature', 'humidity', 'eco2', 'tvoc'];

/** Fixed: the server keeps one reading every minute (server/schedule.mjs). Nobody can change it. */
export const READING_EVERY = 60000;
/** Readings further apart than this mean the device was off or offline (the line breaks there). */
export const OFF_GAP = 5 * 60000;
/** How often the ESP32 sends (and switches its Wi-Fi radio to transmit): once a reading, every minute. */
export const CHECK_IN_SECONDS = READING_EVERY / 1000;
/** The dashboard asks the server for new readings this often. */
export const POLL_MS = 30000;

export const defaults: Settings = {
  deviceName: 'ESP32-WROOM-32', room: 'Smart Fridge V3',
  temperatureMax: 35, humidityMax: 80, eco2Max: 1000, tvocMax: 500,
  supplyVoltage: 5, tariff: 0.27, currency: 'MYR', privacyBlur: true,
  parts: ['esp32', 'wifi', 'board', 'dht11', 'ccs811', 'oled'],
};

// Series colours are checked for colour-vision separation; identity is also carried by labels.
export const metricInfo: Record<Metric, { unit: string; color: string; sensor: string; max: number; digits: number }> = {
  temperature: { unit: '°C', color: '#d9480f', sensor: 'DHT11', max: 50, digits: 1 },
  humidity: { unit: '%', color: '#1c7ed6', sensor: 'DHT11', max: 100, digits: 1 },
  eco2: { unit: 'ppm', color: '#0ca678', sensor: 'CCS811', max: 2000, digits: 0 },
  tvoc: { unit: 'ppb', color: '#c2255c', sensor: 'CCS811', max: 1000, digits: 0 },
};

export const fmt = (m: Metric, v?: number) => v === undefined ? '—' : v.toFixed(metricInfo[m].digits);

// DHT11 reports whole degrees and whole percent; the CCS811 whole ppm and ppb.
function demoValues(i: number, doorOpen: boolean) {
  return {
    temperature: Math.round(26 + Math.sin(i * 0.31) * 1.4 + Math.cos(i * 0.87) * 0.6 + (doorOpen ? 10 : 0)),
    humidity: Math.round(56 + Math.sin(i * 0.2 + 1) * 5 + Math.cos(i * 0.66) * 2.2),
    eco2: Math.round(560 + Math.sin(i * 0.35 + 2) * 90 + Math.cos(i * 0.97) * 30 + (doorOpen ? 520 : 0)),
    tvoc: Math.round(24 + Math.sin(i * 0.41) * 12 + Math.cos(i * 0.73) * 5 + (doorOpen ? 90 : 0)),
  };
}

// Demo values follow the clock (the same moment always gives the same values), with slow waves.
const WAVE = 90 * 60000;
const demoAt = (t: number, doorOpen = false) => demoValues(t / WAVE, doorOpen);

/** Demo: the last 24 hours, one reading a minute like the real device (or `count` readings `step` apart). */
export function createDemoHistory(step = READING_EVERY, count = 24 * 60): Reading[] {
  const last = Math.floor(Date.now() / step) * step;
  return Array.from({ length: count + 1 }, (_, i) => {
    const timestamp = last - (count - i) * step;
    // A few minutes with the door left open, so the alert parts draw too.
    return { id: `demo-${timestamp}`, timestamp, ...demoAt(timestamp, i >= count - 200 && i < count - 190), deviceId: 'ESP32-DEMO', rssi: -54, uptime: 86400 + Math.round(i * step / 1000) };
  });
}

/** Demo readings for any period, at most about 400 points (long periods are thinned like the server's averages). */
export function demoRange(from: number, to: number, shift = 0): Reading[] {
  const step = Math.max(READING_EVERY, Math.ceil((to - from) / 400 / READING_EVERY) * READING_EVERY);
  const out: Reading[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    const v = demoAt(t + shift);
    out.push({ id: `demo-r-${t}`, timestamp: t, ...v, temperature: v.temperature - (shift ? 1 : 0), deviceId: 'ESP32-DEMO' });
  }
  return out;
}

/** The demo's next reading once a new minute starts, else null. */
export function nextDemoReading(previous: Reading): Reading | null {
  const slot = Math.floor(Date.now() / READING_EVERY) * READING_EVERY;
  if (slot <= previous.timestamp) return null;
  return {
    ...previous, id: `demo-${slot}`, timestamp: slot,
    ...demoAt(slot),
    uptime: (previous.uptime ?? 0) + Math.round((slot - previous.timestamp) / 1000),
  };
}

// Typical household price per kWh, used as a starting value when the currency changes.
// MYR: TNB domestic energy charge; USD: US residential average; IQD: Iraq's first domestic tier.
export const currencies: Record<Currency, { tariff: number; symbol: (lang: Lang) => string }> = {
  MYR: { tariff: 0.27, symbol: () => 'RM' },
  USD: { tariff: 0.17, symbol: () => '$' },
  IQD: { tariff: 10, symbol: lang => lang === 'ar' ? 'د.ع' : 'IQD' },
};

const SETTINGS_KEY = 'kelvin-settings';

/** Settings saved in this browser before they moved to the account (read once, to carry them over). */
export function loadSettings(): Settings {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { return defaults; }
}

/** Fills gaps from the defaults and rejects anything out of range. */
export function sanitizeSettings(saved: unknown): Settings {
  try {
    const s = { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) } as Settings;
    const currency = s.currency as string;
    if (currency === 'RM') s.currency = 'MYR'; // saved before the currency list existed
    else if (!(currency in currencies)) s.currency = defaults.currency;
    if (typeof s.privacyBlur !== 'boolean') s.privacyBlur = true;
    const inRange = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
    if (!s.deviceName || !s.room || !s.currency || !Array.isArray(s.parts) ||
      !inRange(s.temperatureMax, -40, 125) || !inRange(s.humidityMax, 1, 100) || !inRange(s.eco2Max, 400, 65535) ||
      !inRange(s.tvocMax, 1, 65535) ||
      !inRange(s.supplyVoltage, 3, 24) || !inRange(s.tariff, 0, 100)) return defaults;
    delete (s as { interval?: number }).interval; // was the dashboard refresh; now fixed
    s.parts = s.parts.filter(id => defaults.parts.includes(id)); // the LED and buzzer were removed
    return s;
  } catch { return defaults; }
}


// Times are shown on a 12-hour clock, with the morning/evening mark in the page's language.
const PERIOD: Record<Lang, { am: string; pm: string }> = { ar: { am: 'ص', pm: 'م' }, en: { am: 'AM', pm: 'PM' }, ms: { am: 'PG', pm: 'PTG' } };
let timeLang: Lang = 'ar';
/** Called by the language switch, so every time on the page uses its AM/PM mark. */
export const setTimeLang = (lang: Lang) => { timeLang = lang; };
const clock = (timestamp: number, seconds: boolean) => {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true }).formatToParts(timestamp);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const mark = PERIOD[timeLang][get('dayPeriod').toUpperCase() === 'AM' ? 'am' : 'pm'];
  return `${get('hour')}:${get('minute')}${seconds ? `:${get('second')}` : ''} ${mark}`;
};

/** 1:30:05 PM (or ص / م, PG / PTG). */
export const timeFormat = (timestamp: number) => clock(timestamp, true);
/** 1:30 PM */
export const shortTime = (timestamp: number) => clock(timestamp, false);

const locales: Record<Lang, string> = { ar: 'ar', en: 'en-GB', ms: 'ms-MY' };
export const dateFormat = (timestamp: number, lang: Lang) => new Intl.DateTimeFormat(locales[lang], {
  day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn',
}).format(timestamp);

export function formatUptime(seconds?: number) {
  if (seconds === undefined) return '—';
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

export const limitFor = (metric: Metric, s: Settings) => ({
  temperature: s.temperatureMax, humidity: s.humidityMax, eco2: s.eco2Max, tvoc: s.tvocMax,
})[metric];

// Every limit is a ceiling: a reading at or above it is an alert.
export const exceeds = (metric: Metric, value: number, s: Settings) => value >= limitFor(metric, s);

export const isAlert = (r: Reading, s: Settings) => metrics.some(m => exceeds(m, r[m], s));

export const formatEnergy = (wh?: number) => wh === undefined ? { value: '—', unit: 'Wh' }
  : wh >= 1000 ? { value: (wh / 1000).toFixed(2), unit: 'kWh' } : { value: wh.toFixed(wh < 10 ? 2 : 1), unit: 'Wh' };

/** Charge drawn from the supply: mAh, or Ah from 1,000 mAh. */
export const formatCharge = (mAh?: number) => mAh === undefined ? { value: '—', unit: 'mAh' }
  : mAh >= 1000 ? { value: (mAh / 1000).toFixed(mAh >= 10000 ? 1 : 2), unit: 'Ah' } : { value: mAh.toFixed(mAh < 10 ? 2 : 0), unit: 'mAh' };

export const formatMoney = (amount?: number) => amount === undefined ? '—' : amount.toFixed(amount < 0.01 ? 4 : amount < 0.1 ? 3 : 2);
