export type Reading = {
  id: string;
  timestamp: number;
  temperature: number;
  humidity: number;
  eco2: number;
  tvoc: number;
  deviceId?: string;
  rssi?: number;
  ip?: string;
  uptime?: number;
};

export type Settings = {
  deviceName: string;
  room: string;
  temperatureMax: number;
  humidityMax: number;
  eco2Max: number;
  tvocMax: number;
  interval: number;
  supplyVoltage: number;
  tariff: number;
  currency: Currency;
  parts: string[];
  privacyBlur: boolean;
};

export type Metric = 'temperature' | 'humidity' | 'eco2' | 'tvoc';
export type Page = 'overview' | 'energy' | 'sensors' | 'history' | 'alerts' | 'account' | 'users' | 'system'
  | 'settings' | 'telegram' | 'connect' | 'guide' | 'support' | 'audit';
export type Lang = 'ar' | 'en' | 'ms';
export type Currency = 'MYR' | 'USD' | 'IQD';

export type TelegramConfig = {
  enabled: boolean;
  configured: boolean;
  chatId: string;
  cooldownMin: number;
  lang: Lang;
  limits: Record<Metric, { min: number | null; max: number | null }>;
  templates: { alert: string; back: string };
  defaults: { alert: string; back: string };
  placeholders: string[];
  ntfy: { enabled: boolean; server: string; topic: string; priority: NtfyPriority; hasToken: boolean; fromEnv: boolean };
};
export type NtfyPriority = 'min' | 'low' | 'default' | 'high' | 'urgent';
