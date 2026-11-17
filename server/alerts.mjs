import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const METRICS = { temperature: '°C', humidity: '%', eco2: 'ppm', tvoc: 'ppb' };
const LANGS = ['ar', 'en', 'ms'];
export const PLACEHOLDERS = ['sensor', 'state', 'value', 'limit', 'device', 'time'];
const MAX_TEMPLATE = 1000;

// Telegram messages follow the language picked in the dashboard, unless the
// user wrote their own message, which is then sent as written.
const TEXT = {
  ar: {
    names: { temperature: 'درجة الحرارة', humidity: 'الرطوبة', eco2: 'ثاني أكسيد الكربون المكافئ (eCO2)', tvoc: 'المركبات العضوية المتطايرة (TVOC)' },
    low: 'انخفضت عن الحد المسموح', high: 'ارتفعت عن الحد المسموح',
    alert: '⚠️ {sensor} {state}\nالقراءة: {value}\nالحد: {limit}\nالجهاز: {device}\nالوقت: {time}',
    back: '✅ {sensor} رجعت للمعدل الطبيعي: {value}',
    test: '🧪 Kelvin: رسالة تجريبية بالشكل الذي ستصلك به التنبيهات:',
  },
  en: {
    names: { temperature: 'Temperature', humidity: 'Humidity', eco2: 'eCO2', tvoc: 'TVOC' },
    low: 'dropped below the limit', high: 'rose above the limit',
    alert: '⚠️ {sensor} {state}\nReading: {value}\nLimit: {limit}\nDevice: {device}\nTime: {time}',
    back: '✅ {sensor} is back to normal: {value}',
    test: '🧪 Kelvin: a test message, shaped like your alerts:',
  },
  ms: {
    names: { temperature: 'Suhu', humidity: 'Kelembapan', eco2: 'eCO2', tvoc: 'TVOC' },
    low: 'turun bawah had', high: 'naik melebihi had',
    alert: '⚠️ {sensor} {state}\nBacaan: {value}\nHad: {limit}\nPeranti: {device}\nMasa: {time}',
    back: '✅ {sensor} kembali normal: {value}',
    test: '🧪 Kelvin: mesej ujian, sama bentuk dengan amaran anda:',
  },
};

// ntfy (ntfy.sh or your own ntfy server): push notifications to phones and computers.
// Anyone who knows a topic on ntfy.sh can read it, so the topic should be long and random.
export const NTFY_PRIORITIES = ['min', 'low', 'default', 'high', 'urgent'];
const NTFY_LEVEL = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };
const defaultNtfy = { enabled: false, server: 'https://ntfy.sh', topic: '', token: '', priority: 'high' };

export const defaultConfig = {
  enabled: true, token: '', chatId: '', cooldownMin: 15, lang: 'ar', ntfy: defaultNtfy,
  // An empty template means "use the default message for the current language".
  templates: { alert: '', back: '' },
  limits: { temperature: { min: 2, max: 35 }, humidity: { min: 20, max: 80 }, eco2: { min: null, max: 1000 }, tvoc: { min: null, max: 500 } },
};

const num = v => (v === null || v === '' || v === undefined ? null : Number.isFinite(+v) ? +v : undefined);

/** Fills {placeholders}; unknown ones are left as typed so the user can see the mistake. */
export const render = (template, vars) => template.replace(/\{(\w+)\}/g, (match, key) => key in vars ? String(vars[key]) : match);

export function sanitizeConfig(input, current = defaultConfig) {
  const next = { ...current, limits: structuredClone(current.limits), templates: { ...defaultConfig.templates, ...current.templates }, ntfy: { ...defaultNtfy, ...current.ntfy } };
  const n = input.ntfy;
  if (n && typeof n === 'object') {
    if (typeof n.enabled === 'boolean') next.ntfy.enabled = n.enabled;
    if (typeof n.server === 'string' && n.server.trim()) {
      let u;
      try { u = new URL(n.server.trim()); } catch { throw new Error('ntfy.server must be a web address.'); }
      if (u.protocol !== 'https:' || u.username || u.password) throw new Error('ntfy.server must start with https://');
      next.ntfy.server = u.origin + u.pathname.replace(/\/+$/, '');
    }
    if (typeof n.topic === 'string') {
      const t = n.topic.trim();
      if (t && !/^[A-Za-z0-9_-]{1,64}$/.test(t)) throw new Error('ntfy.topic may use letters, digits, - and _ only (up to 64).');
      next.ntfy.topic = t;
    }
    if (typeof n.token === 'string' && n.token.trim()) next.ntfy.token = n.token.trim();
    if (n.clearToken === true) next.ntfy.token = '';
    if (NTFY_PRIORITIES.includes(n.priority)) next.ntfy.priority = n.priority;
  }
  if (next.ntfy.enabled && !next.ntfy.topic) throw new Error('Choose an ntfy topic before turning ntfy on.');
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  if (typeof input.token === 'string' && input.token.trim()) next.token = input.token.trim();
  if (LANGS.includes(input.lang)) next.lang = input.lang;
  if (typeof input.chatId === 'string' || typeof input.chatId === 'number') next.chatId = String(input.chatId).trim();
  if (input.cooldownMin !== undefined) {
    const c = +input.cooldownMin;
    if (!Number.isFinite(c) || c < 0 || c > 1440) throw new Error('cooldownMin must be between 0 and 1440.');
    next.cooldownMin = c;
  }
  for (const kind of ['alert', 'back']) {
    const v = input.templates?.[kind];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > MAX_TEMPLATE) throw new Error(`templates.${kind} must be text of at most ${MAX_TEMPLATE} characters.`);
    next.templates[kind] = v.trim();
  }
  for (const m of Object.keys(METRICS)) for (const side of ['min', 'max']) {
    const v = input.limits?.[m]?.[side];
    if (v === undefined) continue;
    const n = num(v);
    if (n === undefined) throw new Error(`limits.${m}.${side} must be a number or null.`);
    next.limits[m][side] = n;
  }
  return next;
}

/**
 * `load` / `save` read and write the settings (the database in the server); with only `file`
 * they use that JSON file, as the tests do.
 */
export function createAlerts({ file, load, save, loadState, saveState, env = process.env, fetchImpl = fetch, now = Date.now }) {
  load ??= async () => JSON.parse(await readFile(file, 'utf8'));
  save ??= async value => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value), 'utf8'); };
  let config = structuredClone(defaultConfig);
  // metric -> { status: 'ok'|'low'|'high', lastSent }. With loadState/saveState it is kept
  // in the store, so a server copy that starts fresh still knows an alert was already sent.
  let state = {};
  const ready = Promise.resolve().then(load).then(v => { if (v) config = sanitizeConfig(v, config); }).catch(() => {});

  const creds = () => ({ token: env.TELEGRAM_BOT_TOKEN || config.token, chatId: env.TELEGRAM_CHAT_ID || config.chatId });
  const ntfy = () => ({
    ...config.ntfy,
    server: env.NTFY_SERVER || config.ntfy.server, topic: env.NTFY_TOPIC || config.ntfy.topic, token: env.NTFY_TOKEN || config.ntfy.token,
    enabled: Boolean(env.NTFY_TOPIC) || config.ntfy.enabled,
  });
  const telegramReady = () => { const c = creds(); return Boolean(c.token && c.chatId); };
  const ntfyReady = () => { const n = ntfy(); return n.enabled && Boolean(n.topic); };
  const text = () => TEXT[config.lang] || TEXT.ar;
  const template = kind => config.templates[kind] || text()[kind];
  const clock = () => new Date(now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

  async function send(message) {
    const { token, chatId } = creds();
    if (!token || !chatId) throw new Error('Telegram bot token and chat ID are not configured.');
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
    if (!res.ok) throw new Error(`Telegram rejected the message (${res.status}).`);
  }

  /** One push to ntfy (JSON publishing, so Arabic titles need no header encoding). */
  async function sendNtfy({ title, message, kind }) {
    const n = ntfy();
    if (!n.topic) throw new Error('No ntfy topic is set.');
    const res = await fetchImpl(n.server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(n.token ? { Authorization: `Bearer ${n.token}` } : {}) },
      body: JSON.stringify({
        topic: n.topic, title, message,
        priority: kind === 'alert' ? NTFY_LEVEL[n.priority] : 3,
        tags: [kind === 'alert' ? 'warning' : kind === 'back' ? 'white_check_mark' : 'test_tube', 'kelvin'],
      }),
    });
    if (!res.ok) throw new Error(`ntfy refused the message (${res.status}).`);
  }

  /** Sends an event on every channel that is set up; one failing does not stop the others. */
  async function deliver(event) {
    const jobs = [];
    if (telegramReady()) jobs.push(['telegram', send(event.message)]);
    if (ntfyReady()) jobs.push(['ntfy', sendNtfy(event)]);
    for (const [name, job] of jobs) {
      try { await job; } catch (e) { console.error(`[alerts:${name}]`, String(e.message).replace(creds().token || '\0', '***').replace(ntfy().token || '\0', '***')); }
    }
  }

  function evaluate(reading) {
    const events = [];
    const tx = text();
    for (const [m, unit] of Object.entries(METRICS)) {
      const v = reading[m], { min, max } = config.limits[m];
      if (typeof v !== 'number') continue;
      const status = min !== null && v < min ? 'low' : max !== null && v > max ? 'high' : 'ok';
      const s = state[m] ||= { status: 'ok', lastSent: 0 };
      const cooled = now() - s.lastSent >= config.cooldownMin * 60000;
      const vars = { sensor: tx.names[m], value: `${v} ${unit}`, device: reading.deviceId, time: clock() };
      if (status !== 'ok' && (status !== s.status || cooled)) {
        const limit = status === 'low' ? min : max;
        const stateText = status === 'low' ? tx.low : tx.high;
        events.push({ kind: 'alert', title: `${tx.names[m]} ${stateText}`, message: render(template('alert'), { ...vars, state: stateText, limit: `${limit} ${unit}` }) });
        s.lastSent = now();
      } else if (status === 'ok' && s.status !== 'ok') {
        events.push({ kind: 'back', title: `${tx.names[m]} ✓`, message: render(template('back'), { ...vars, state: '', limit: '' }) });
        s.lastSent = 0;
      }
      s.status = status;
    }
    return events;
  }

  return {
    ready,
    /** Reloads the Telegram settings (another server copy may have changed them). */
    async refresh() {
      try { const v = await load(); config = sanitizeConfig(v ?? {}, structuredClone(defaultConfig)); } catch {}
    },
    getPublic() {
      const { token, chatId } = creds();
      const n = ntfy();
      return {
        enabled: config.enabled, configured: !!(token && chatId), chatId, cooldownMin: config.cooldownMin, lang: config.lang,
        // The ntfy access token never leaves the server; only whether one is set.
        ntfy: { enabled: n.enabled, server: n.server, topic: n.topic, priority: n.priority, hasToken: Boolean(n.token), fromEnv: Boolean(env.NTFY_TOPIC) },
        limits: config.limits, templates: config.templates,
        defaults: { alert: text().alert, back: text().back }, placeholders: PLACEHOLDERS,
      };
    },
    async update(input) {
      await ready;
      config = sanitizeConfig(input, config);
      await save(config);
    },
    /** A sample alert in the user's own wording, on one channel, so they can see what will arrive. */
    async test(channel = 'telegram') {
      await ready;
      const tx = text();
      const sample = render(template('alert'), {
        sensor: tx.names.temperature, state: tx.high, value: '37 °C', limit: `${config.limits.temperature.max ?? 35} °C`, device: 'ESP32-WROOM-32', time: clock(),
      });
      if (channel === 'ntfy') return sendNtfy({ kind: 'test', title: tx.test.replace(/:$/, ''), message: sample });
      return send(`${tx.test}\n\n${sample}`);
    },
    async check(reading) {
      await ready;
      if (!config.enabled) return;
      if (loadState) { try { state = (await loadState()) ?? {}; } catch { state = {}; } }
      const events = evaluate(reading);
      if (saveState) await saveState(state).catch(() => {});
      for (const event of events) await deliver(event);
    },
  };
}
