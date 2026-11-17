import type { Currency, Lang, Metric, Reading, Settings } from './types';

export const metrics: Metric[] = ['temperature', 'humidity', 'eco2', 'tvoc'];

export const defaults: Settings = {
  deviceName: 'ESP32-WROOM-32', room: 'Smart Fridge V3',
  temperatureMax: 35, humidityMax: 80, eco2Max: 1000, tvocMax: 500, interval: 5,
  supplyVoltage: 5, tariff: 0.27, currency: 'MYR', privacyBlur: true,
  parts: ['esp32', 'wifi', 'board', 'dht11', 'ccs811', 'oled', 'led', 'buzzer'],
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

export function createDemoHistory(): Reading[] {
  const now = Date.now();
  return Array.from({ length: 289 }, (_, i) => ({
    id: `demo-${i}`, timestamp: now - (288 - i) * 5 * 60 * 1000,
    // A 35-minute stretch with the door left open, so the alert parts draw too.
    ...demoValues(i, i >= 200 && i < 207),
    deviceId: 'ESP32-DEMO', rssi: -54, uptime: 86400 + i * 300,
  }));
}

/** Demo readings for any earlier period (for comparison): one every 5 minutes, a little different from today. */
export function demoRange(from: number, to: number): Reading[] {
  const out: Reading[] = [];
  for (let t = Math.ceil(from / 300000) * 300000; t <= to; t += 300000) {
    const v = demoValues(t / 300000 + 11, false);
    out.push({ id: `demo-cmp-${t}`, timestamp: t, ...v, temperature: v.temperature - 1, deviceId: 'ESP32-DEMO' });
  }
  return out;
}

export function nextDemoReading(previous: Reading): Reading {
  return {
    ...previous, id: `demo-${Date.now()}`, timestamp: Date.now(),
    ...demoValues(Date.now() / 300000, false),
    uptime: (previous.uptime ?? 0) + 5,
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
      !inRange(s.tvocMax, 1, 65535) || ![2, 5, 10, 30].includes(s.interval) ||
      !inRange(s.supplyVoltage, 3, 24) || !inRange(s.tariff, 0, 100)) return defaults;
    return s;
  } catch { return defaults; }
}


export const timeFormat = (timestamp: number) => new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(timestamp);

export const shortTime = (timestamp: number) => new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(timestamp);

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

export const formatMoney = (amount?: number) => amount === undefined ? '—' : amount.toFixed(amount < 0.01 ? 4 : amount < 0.1 ? 3 : 2);
