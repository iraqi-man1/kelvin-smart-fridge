import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleAlert, FileSpreadsheet,
  ExternalLink, Lock, Menu, Minus, PlugZap, RefreshCw, Moon, Search, Settings2, Sun, X,
} from 'lucide-react';
import { ScaleBar, StripChart, type Comparison } from './Charts';
import { AuditPage } from './AuditPage';
import { horizonFor } from './forecast';
import {
  createDemoHistory, currencies, dateFormat, defaults, exceeds, fmt, formatEnergy, formatMoney, formatUptime, isAlert, limitFor,
  demoRange, metricInfo, metrics, nextDemoReading, POLL_MS, READING_EVERY, sanitizeSettings, shortTime, timeFormat,
} from './data';
import { AccountPage, Avatar } from './Account';
import { api, canManage, type Prefs, type User } from './accountApi';
import { SupportPage } from './SupportPage';
import { SideNav } from './SideNav';
import { SystemPage } from './SystemPage';
import { UsersPage } from './Users';
import { ConnectGuide } from './Connect';
import type { LockPrefs } from './LockScreen';
import { EnergyPage, useEnergy } from './Energy';
import { downloadExcel } from './excel';
import { dictionaries, I18n, langs } from './i18n';
import { parts } from './power';
import { Secret, SecretInput, Segmented, SelectField, SwitchField, ThemeToggle, TooltipProvider, useTheme } from './ui';
import type { Lang, Metric, NtfyPriority, Page, Reading, Settings, TelegramConfig } from './types';

/** A long random ntfy topic: on ntfy.sh, whoever knows the name can read it. */
const randomTopic = () => `kelvin-${Array.from(crypto.getRandomValues(new Uint8Array(10)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')}`;

export const APP_NAME = 'Kelvin';
export const STUDENT = 'ALSARRAY ALI AHMED ALI';

// Pages with readings: they get the Excel and Refresh buttons in the header.
const DATA_PAGES: Page[] = ['overview', 'energy', 'sensors', 'history', 'alerts'];

const limitKey: Record<Metric, keyof Settings> = { temperature: 'temperatureMax', humidity: 'humidityMax', eco2: 'eco2Max', tvoc: 'tvocMax' };
const limitRange: Record<Metric, [number, number, number]> = { temperature: [-40, 125, 0.1], humidity: [1, 100, 0.1], eco2: [400, 65535, 1], tvoc: [1, 65535, 1] };

type AppProps = {
  user: User; onUser: (u: User) => void; onSignedOut: (message: string) => void; lang: Lang; setLang: (l: Lang) => void;
  onLock: () => void; lockPrefs: LockPrefs; setLockPrefs: (p: LockPrefs) => void; savePrefs: (patch: Prefs) => void;
};

function App({ user, onUser, onSignedOut, lang, setLang, onLock, lockPrefs, setLockPrefs, savePrefs }: AppProps) {
  const t = dictionaries[lang];
  const Forward = t.dir === 'rtl' ? ArrowLeft : ArrowRight;
  const [page, setPage] = useState<Page>('overview');
  // Saved with the account on the server, so they are the same on every device.
  const [settings, setSettings] = useState(() => sanitizeSettings(user.prefs?.settings));
  // A viewer looks only: the settings come from the admin and cannot be changed here.
  const viewer = user.role === 'viewer';
  const [draft, setDraft] = useState(settings);
  const [mode, setMode] = useState<'demo' | 'live'>(() => user.prefs?.mode === 'live' ? 'live' : 'demo');
  const [demo, setDemo] = useState<Reading[]>(createDemoHistory);
  const [live, setLive] = useState<Reading[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const [period, setPeriod] = useState(24);
  const [showForecast, setShowForecast] = useState(true);
  // Compare the chart with an earlier period: the one just before, yesterday, or last week.
  const [compareWith, setCompareWith] = useState<'off' | 'prev' | 'day' | 'week'>('off');
  const [compareData, setCompareData] = useState<Reading[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [tablePage, setTablePage] = useState(0);
  const [apiUrl, setApiUrl] = useState(`${location.origin}/api/readings`);
  const [storage, setStorage] = useState<{ kind: string; label: string; readings: number } | null>(null);
  const [lastReadAlert, setLastReadAlert] = useState(0);
  const { theme, toggle } = useTheme();
  const toggleTheme = () => { toggle(); savePrefs({ theme: theme === 'dark' ? 'light' : 'dark' }); };
  const [tgEnabled, setTgEnabled] = useState(true);
  const [tg, setTg] = useState<TelegramConfig | null>(null);
  const [tgToken, setTgToken] = useState('');
  // ntfy: push notifications, next to Telegram
  const [nt, setNt] = useState({ enabled: false, server: 'https://ntfy.sh', topic: '', priority: 'high' as NtfyPriority, token: '' });
  const [tgBusy, setTgBusy] = useState(false);
  const [tpl, setTpl] = useState({ alert: '', back: '' });
  const [tplFocus, setTplFocus] = useState<'alert' | 'back'>('alert');
  const tplRefs = useRef<Record<'alert' | 'back', HTMLTextAreaElement | null>>({ alert: null, back: null });
  const [exporting, setExporting] = useState(false);
  const request = useRef<AbortController | null>(null);
  const lastTs = useRef(0); // newest reading already shown

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  // Asked each time the connection window opens: the app may have started while locked,
  // when the server refuses, and the computer's network address can change.
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/info', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject()).then(info => {
      if (info.ingestUrl) setApiUrl(info.ingestUrl);
      if (info.storage) setStorage(info.storage);
    }).catch(() => {});
    return () => controller.abort();
  }, [page === 'connect']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.dataset.privacy = settings.privacyBlur ? 'on' : 'off'; }, [settings.privacyBlur]);
  // Telegram messages are written by the server, so it follows the dashboard language.
  useEffect(() => {
    if (canManage(user)) fetch('/api/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) }).catch(() => {});
  }, [lang]);

  const fetchLive = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      // After the first load only the new readings are asked for (lighter on the server).
      const since = lastTs.current;
      const response = await fetch(since ? `/api/readings?since=${since}` : '/api/readings', { signal: controller.signal });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (!Array.isArray(body.readings)) throw new Error();
      if (controller.signal.aborted) return;
      const fresh: Reading[] = body.readings;
      if (fresh.length) lastTs.current = fresh.at(-1)!.timestamp;
      setLive(previous => since ? (fresh.length ? [...previous, ...fresh].slice(-2000) : previous) : fresh);
      setError(false);
    } catch { if (!controller.signal.aborted) setError(true); }
  }, []);

  useEffect(() => {
    if (mode === 'live') fetchLive();
    const id = setInterval(() => {
      if (mode === 'demo') setDemo(previous => { const next = nextDemoReading(previous.at(-1)!); return next ? [...previous, next].slice(-2000) : previous; });
      else if (!document.hidden) fetchLive();
    }, POLL_MS);
    return () => { clearInterval(id); request.current?.abort(); };
  }, [mode, fetchLive]);

  const readings = mode === 'demo' ? demo : live;
  const latest = readings.at(-1);
  const previous = readings.at(-2);
  // One reading is kept every 1 h 30 min (fixed), so the last one stays current until the
  // next is due, with 10 minutes' grace.
  const fresh = Boolean(latest && now - latest.timestamp < READING_EVERY + 600000);
  const connected = mode === 'demo' || (fresh && !error);
  const exceeded = latest ? metrics.filter(m => exceeds(m, latest[m], settings)) : [];
  const energy = useEnergy(readings, settings, now);
  const chartData = useMemo(() => readings.filter(r => r.timestamp >= now - period * 3600000), [readings, period, now]);
  const compareOffset = compareWith === 'prev' ? period * 3600000 : compareWith === 'day' ? 86400000 : compareWith === 'week' ? 7 * 86400000 : 0;
  // The earlier period is fetched again once a minute (it moves with "now"), not every second.
  const minute = Math.floor(now / 60000);
  useEffect(() => {
    if (!compareOffset) { setCompareData([]); return; }
    const to = minute * 60000 + 60000 - compareOffset, from = to - period * 3600000 - 60000;
    if (mode === 'demo') { setCompareData(demoRange(from, to)); return; }
    let live = true;
    api.readingsRange(from, to, 300).then(r => { if (live) setCompareData(r); }).catch(() => { if (live) setCompareData([]); });
    return () => { live = false; };
  }, [compareOffset, period, minute, mode]);
  const comparison = useMemo<Comparison | null>(() => compareOffset ? { data: compareData, offset: compareOffset, label: t.chart.cmpLabel[compareWith as 'prev' | 'day' | 'week'] } : null, [compareData, compareOffset, compareWith, t]);
  const today = useMemo(() => { const start = new Date(now); start.setHours(0, 0, 0, 0); return readings.filter(r => r.timestamp >= start.getTime()); }, [readings, now]);
  const alerts = useMemo(() => readings.filter((r, i) => isAlert(r, settings) && (i === 0 || !isAlert(readings[i - 1], settings))).slice(-30).reverse(), [readings, settings]);
  const unread = alerts.filter(a => a.timestamp > lastReadAlert).length;
  const filteredReadings = useMemo(() => readings.slice().reverse().filter(r => {
    const matches = `${timeFormat(r.timestamp)} ${r.temperature} ${r.humidity} ${r.eco2} ${r.tvoc}`.includes(query);
    return matches && (filter === 'all' || (filter === 'alerts' ? isAlert(r, settings) : !isAlert(r, settings)));
  }), [readings, query, filter, settings]);
  useEffect(() => setTablePage(0), [query, filter, page, mode]);
  const rows = page === 'history' ? filteredReadings.slice(tablePage * 12, tablePage * 12 + 12) : readings.slice(-5).reverse();
  const pageCount = Math.max(1, Math.ceil(filteredReadings.length / 12));
  const age = latest ? Math.max(0, Math.floor((now - latest.timestamp) / 1000)) : 0;
  const list = (items: string[]) => items.join(t.dir === 'rtl' ? '، ' : ', ');

  function navigate(next: Page) { setPage(next); setMobileNav(false); window.scrollTo({ top: 0 }); }
  async function refresh() {
    setRefreshing(true);
    if (mode === 'demo') setDemo(p => { const next = nextDemoReading(p.at(-1)!); return next ? [...p, next].slice(-2000) : p; });
    else await fetchLive();
    setTimeout(() => setRefreshing(false), 500);
  }
  async function exportData() {
    const exported = page === 'history' ? filteredReadings : readings;
    if (!exported.length) { notify(t.toast.noExport); return; }
    setExporting(true);
    try {
      await downloadExcel({ readings: exported, settings, t, source: mode === 'demo' ? t.status.demo : t.conn.live, app: APP_NAME, student: STUDENT, by: `${user.name} <${user.email}>` });
      notify(t.toast.exported(exported.length));
      api.noteExport().catch(() => {}); // counts toward the Analyst badge
    } catch { notify(t.toast.requestFail); }
    finally { setExporting(false); }
  }
  async function openTelegram() {
    navigate('telegram'); setTgToken(''); setTg(null);
    try {
      const c: TelegramConfig = await (await fetch('/api/alerts')).json();
      setTg(c); setTgEnabled(c.enabled);
      setNt({ enabled: c.ntfy.enabled, server: c.ntfy.server, topic: c.ntfy.topic, priority: c.ntfy.priority, token: '' });
      setTpl({ alert: c.templates?.alert || c.defaults.alert, back: c.templates?.back || c.defaults.back });
    } catch { notify(t.toast.tgReadFail); }
  }
  async function tgRequest(path: string, method: string, body?: unknown, okMessage = '') {
    setTgBusy(true);
    try {
      const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.toast.requestFail);
      if (path === '/api/alerts') { setTg(data); setTgToken(''); }
      if (okMessage) notify(okMessage);
    } catch (e) { notify(e instanceof Error ? e.message : t.toast.requestFail); }
    finally { setTgBusy(false); }
  }
  function openSettings() { setDraft(settings); navigate('settings'); }
  // One way into every page from the menu (Telegram and Settings load their data first).
  const go = (next: Page) => next === 'telegram' ? openTelegram() : next === 'settings' ? openSettings() : navigate(next);
  const openConnect = () => navigate('connect');
  function chooseMode(next: 'demo' | 'live') { setMode(next); savePrefs({ mode: next }); notify(next === 'demo' ? t.toast.sourceDemo : t.toast.sourceLive); }

  const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m);
  function insertTag(key: string) {
    const el = tplRefs.current[tplFocus], value = tpl[tplFocus], tag = `{${key}}`;
    const at = el ? el.selectionStart : value.length, end = el ? el.selectionEnd : value.length;
    setTpl({ ...tpl, [tplFocus]: value.slice(0, at) + tag + value.slice(end) });
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + tag.length, at + tag.length); } });
  }

  const status = !connected
    ? { tone: 'offline', text: error ? t.status.serverError : latest ? t.status.stale : t.status.waiting }
    : exceeded.length
      ? { tone: 'alert', text: t.status.over(list(exceeded.map(m => t.metric[m].short))) }
      : { tone: 'ok', text: t.status.ok };

  function readingTable() {
    const full = page === 'history';
    return <section className={`panel readings-panel ${full ? 'span-all' : 'span-2'}`}>
      <header className="panel-head">
        <div><h2>{full ? t.table.all : t.table.latest}</h2><p>{full ? t.table.count(filteredReadings.length) : t.table.lastOf(rows.length, readings.length)}</p></div>
        {!full && <button className="text-button" onClick={() => navigate('history')}>{t.table.viewLog}<Forward size={15}/></button>}
      </header>
      {full && <div className="table-tools">
        <label className="search-field"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.table.search} aria-label={t.table.searchAria}/></label>
        <SelectField label={t.table.filter} value={filter} onChange={setFilter} options={[['all', t.table.fAll], ['normal', t.table.fNormal], ['alerts', t.table.fAlerts]]}/>
      </div>}
      <div className="table-scroll"><table>
        <thead><tr><th>{t.table.time}</th>{metrics.map(m => <th key={m} className="num">{t.metric[m].short} <span dir="ltr">({metricInfo[m].unit})</span></th>)}<th>{t.table.state}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td className="mono"><span dir="ltr">{timeFormat(r.timestamp)}</span></td>
          {metrics.map(m => <td key={m} className={`num ${exceeds(m, r[m], settings) ? 'over' : ''}`}><span dir="ltr">{fmt(m, r[m])}</span></td>)}
          <td>{isAlert(r, settings) ? <span className="state alert"><CircleAlert size={14}/>{t.table.over}</span> : <span className="state ok">{t.table.within}</span>}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <div className="empty-state">{readings.length ? t.table.noMatch : t.table.empty}</div>}</div>
      {full && <footer className="table-pagination">
        <span>{mode === 'demo' ? t.table.demoData : t.table.deviceData}</span>
        <div><button className="button" disabled={tablePage === 0} onClick={() => setTablePage(p => p - 1)}>{t.table.prev}</button><span className="mono" dir="ltr">{tablePage + 1} / {pageCount}</span><button className="button" disabled={tablePage + 1 >= pageCount} onClick={() => setTablePage(p => p + 1)}>{t.table.next}</button></div>
      </footer>}
    </section>;
  }

  const readouts = <div className="readouts">{metrics.map(metric => {
    const info = metricInfo[metric];
    const v = latest?.[metric];
    const over = v !== undefined && exceeds(metric, v, settings);
    const delta = v !== undefined && previous ? +(v - previous[metric]).toFixed(info.digits) : undefined;
    const Trend = delta === undefined || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
    return <article className={`metric-card ${metric} ${over ? 'is-over' : ''}`} key={metric}>
      <header><span className="swatch" style={{ background: info.color }}/><h2>{t.metric[metric].name}</h2><span className="source mono">{info.sensor}</span></header>
      <div className="metric-value" dir="ltr"><strong className="mono">{fmt(metric, v)}</strong><span>{info.unit}</span></div>
      <div className="metric-meta">
        {over ? <span className="state alert"><CircleAlert size={14}/>{t.card.above}</span>
          : <span className="trend"><Trend size={14}/><span className="mono" dir="ltr">{delta === undefined ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(info.digits)}`}</span> {t.card.vsPrevious}</span>}
        <span className="limit-note">{t.card.max} <span className="mono" dir="ltr">{limitFor(metric, settings)}</span></span>
      </div>
      <ScaleBar metric={metric} value={v} settings={settings}/>
    </article>;
  })}</div>;

  const compareOptions: (readonly ['off' | 'prev' | 'day' | 'week', string])[] = [['off', t.chart.cmp.off], ['prev', t.chart.cmp.prev], ...(period < 24 ? [['day', t.chart.cmp.day] as const] : []), ...(period < 168 ? [['week', t.chart.cmp.week] as const] : [])];
  const chart = <section className={`panel chart-panel ${page === 'sensors' ? 'span-all' : 'span-2'}`}>
    <header className="panel-head">
      <div><h2>{t.chart.title}</h2><p>{t.chart.sub}</p></div>
      <div className="chart-controls">
        <label className="fc-toggle"><input type="checkbox" checked={showForecast} onChange={e => setShowForecast(e.target.checked)}/>{t.chart.showForecast}</label>
        <Segmented label={t.chart.period} value={String(period)} onChange={v => { setPeriod(+v); if ((+v >= 24 && compareWith === 'day') || (+v >= 168 && compareWith === 'week')) setCompareWith('prev'); }} options={[['24', t.chart.h24], ['72', t.chart.d3], ['168', t.chart.d7]]}/>
        <label className="cmp-select"><span>{t.chart.compare}</span>
          <select value={compareWith} onChange={e => setCompareWith(e.target.value as typeof compareWith)}>{compareOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
    </header>
    <StripChart data={chartData} start={now - period * 3600000} end={now} settings={settings} horizon={showForecast ? horizonFor(period) : 0} compare={comparison}/>
  </section>;

  const device = <section className="panel device-panel">
    <header className="panel-head"><div><h2>{t.device.title}</h2><p>{settings.deviceName}</p></div></header>
    <dl className="spec-list">
      <div><dt>{t.device.board}</dt><dd>ESP32-WROOM-32 DevKit</dd></div>
      <div><dt>{t.device.location}</dt><dd>{settings.room}</dd></div>
      <div><dt>{t.device.id}</dt><dd className="mono">{latest?.deviceId ?? '—'}</dd></div>
      <div><dt>{t.device.signal}</dt><dd className="mono" dir="ltr">{latest?.rssi !== undefined ? `${latest.rssi} dBm` : '—'}</dd></div>
      <div><dt>{t.device.uptime}</dt><dd className="mono" dir="ltr">{formatUptime(latest?.uptime)}</dd></div>
      <div><dt>{t.device.sensors}</dt><dd>DHT11 · CCS811</dd></div>
      <div><dt>{t.device.storage}</dt><dd>{storage ? <span className={`storage-tag ${storage.kind}`}>{storage.kind === 'postgres' ? storage.label : t.device.files}</span> : '—'}</dd></div>
    </dl>
    <button className="button full" onClick={openConnect}><PlugZap size={16}/>{t.device.setup}</button>
  </section>;

  const todayEnergy = formatEnergy(energy.todayWh);
  const energySummary = energy.hasData && <section className="panel energy-summary span-all">
    <header className="panel-head">
      <div><h2>{t.summary.title}</h2><p>{t.summary.sub}</p></div>
      <button className="text-button" onClick={() => navigate('energy')}>{t.summary.details}<Forward size={15}/></button>
    </header>
    <dl className="energy-figures">
      <div><dt>{t.e.powerNow}</dt><dd><b className="mono">{energy.watts.toFixed(2)}</b> W</dd></div>
      <div><dt>{t.e.today}</dt><dd><b className="mono">{todayEnergy.value}</b> {todayEnergy.unit}</dd></div>
      <div><dt>{t.e.cost}</dt><dd><b className="mono">{formatMoney(energy.todayCost)}</b> {currencies[settings.currency].symbol(lang)}</dd></div>
      <div><dt>{t.e.month}</dt><dd><b className="mono">{energy.monthKwh.toFixed(2)}</b> kWh</dd></div>
    </dl>
  </section>;

  const todayPanel = <section className="panel today-panel">
    <header className="panel-head"><div><h2>{t.today.title}</h2><p>{t.today.since(today.length.toLocaleString('en-US'))}</p></div></header>
    <table className="compact">
      <thead><tr><th/><th className="num">{t.today.min}</th><th className="num">{t.today.avg}</th><th className="num">{t.today.max}</th></tr></thead>
      <tbody>{metrics.map(m => {
        const vals = today.map(r => r[m]);
        const cell = (n?: number) => <td className="num"><span dir="ltr">{fmt(m, n)}</span></td>;
        return <tr key={m}><th scope="row"><span className="swatch" style={{ background: metricInfo[m].color }}/>{t.metric[m].short} <span className="muted" dir="ltr">{metricInfo[m].unit}</span></th>
          {cell(vals.length ? Math.min(...vals) : undefined)}{cell(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined)}{cell(vals.length ? Math.max(...vals) : undefined)}</tr>;
      })}</tbody>
    </table>
    <p className="today-foot">{t.today.over} <b className="mono">{today.filter(r => isAlert(r, settings)).length}</b></p>
  </section>;

  const wiring: [string, string, string][] = [
    ['DHT11', '+ / VCC', '3V3'], ['DHT11', 'S / OUT', 'GPIO 27'], ['DHT11', '− / GND', 'GND'],
    ['CCS811', 'VCC', '3V3'], ['CCS811', 'GND', 'GND'], ['CCS811', 'SDA', 'GPIO 33'], ['CCS811', 'SCL', 'GPIO 32'], ['CCS811', 'WAK', t.sensors.toGround],
  ];

  const langSwitch = <div className="lang-switch" role="group" aria-label={t.language}>
    {langs.map(([l, label]) => <button key={l} lang={l} aria-pressed={lang === l} title={dictionaries[l].langName} onClick={() => setLang(l)}>{label}</button>)}
  </div>;

  return <I18n.Provider value={{ lang, t }}><TooltipProvider delayDuration={300}><div className={`app-shell ${mobileNav ? 'nav-open' : ''}`}>
    <header className="mobile-bar">
      <button className="icon-button" onClick={() => setMobileNav(true)} aria-label={t.openMenu}><Menu size={20}/></button>
      <span className="wordmark">{APP_NAME}</span>
      <span className="bar-actions"><ThemeToggle theme={theme} onToggle={toggleTheme}/><button className="icon-button" onClick={openSettings} aria-label={t.settings}><Settings2 size={19}/></button>
        <button className="icon-button avatar-button" onClick={() => navigate('account')} aria-label={t.acc.menu}><Avatar user={user} size={28}/></button></span>
    </header>
    {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label={t.closeMenu}/>}

    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true"/><div><span className="wordmark" lang="en">{APP_NAME}</span><small>{t.tagline}</small></div></div>
      <SideNav page={page} admin={canManage(user)} unread={unread} onGo={go}/>
      {/* Your own things sit at the bottom: settings, theme, lock, then your account. */}
      <div className="nav-group nav-bottom">
        <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={openSettings} aria-current={page === 'settings' ? 'page' : undefined}><Settings2 size={18}/><span>{t.settings}</span></button>
        <button className="nav-item" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}<span>{theme === 'dark' ? t.lightMode : t.darkMode}</span></button>
        <button className="nav-item" onClick={() => { setMobileNav(false); onLock(); }}><Lock size={18}/><span>{t.lock.now}</span><kbd className="nav-kbd" dir="ltr">Ctrl ⇧ L</kbd></button>
      </div>
      <button className={`user-chip ${page === 'account' ? 'active' : ''}`} onClick={() => navigate('account')} aria-current={page === 'account' ? 'page' : undefined}>
        <Avatar user={user} size={34}/>
        <span><b>{user.name}</b><small dir="ltr" className="blurred" aria-hidden="true">{user.email}</small></span>
      </button>
      {langSwitch}
      <footer className="sidebar-foot">
        <span className="credit-label">{t.designedBy}</span>
        <span className="credit-name" lang="en">{STUDENT}</span>
        <span>{t.studentProject} · Universiti Sains Malaysia</span>
        <span className="mono">{APP_NAME} v2.0</span>
      </footer>
    </aside>

    <main>
      <header className="page-head">
        <div><h1>{t.pages[page][0]}</h1><p>{t.pages[page][1]}</p></div>
        <div className="page-actions">
          <span className="date">{dateFormat(now, lang)}</span>
          {DATA_PAGES.includes(page) && <>
          <button className="button" onClick={exportData} disabled={exporting}><FileSpreadsheet size={16}/>{t.exportCsv}</button>
          <button className="button primary" onClick={refresh} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/>{t.refresh}</button>
          </>}
        </div>
      </header>

      {page === 'account' && <AccountPage user={user} onUser={onUser} onSignedOut={onSignedOut} notify={notify} lockPrefs={lockPrefs} setLockPrefs={setLockPrefs} onLock={onLock}/>}

      {page === 'users' && canManage(user) && <UsersPage me={user} notify={notify}/>}

      {page === 'system' && <SystemPage user={user} mode={mode}/>}
      {page === 'support' && <SupportPage user={user} notify={notify}/>}
      {page === 'audit' && canManage(user) && <AuditPage/>}

      {(DATA_PAGES.includes(page) || page === 'system') && <section className={`status-strip ${status.tone}`} aria-label={t.status.aria}>
        <div><span>{t.status.source}</span><button className="source-button" onClick={openConnect}><i className={`dot ${mode === 'live' ? (connected ? 'on' : 'off') : 'demo'}`}/>{mode === 'demo' ? t.status.demo : t.status.live}</button></div>
        <div><span>{t.status.last}</span><b>{latest ? <><span className="mono" dir="ltr">{timeFormat(latest.timestamp)}</span> <span className="muted">· {t.ago(age)}</span></> : '—'}</b></div>
        <div><span>{t.status.interval}</span><b>{t.status.fixedEvery}{latest && now < latest.timestamp + READING_EVERY && <span className="muted"> · {t.status.next} <span className="mono" dir="ltr">{shortTime(latest.timestamp + READING_EVERY)}</span></span>}</b></div>
        <div className="status-cell"><span>{t.status.state}</span><b>{status.tone !== 'ok' && <CircleAlert size={15}/>}{status.text}</b></div>
      </section>}

      {(page === 'overview' || page === 'sensors') && readouts}

      {page === 'overview' && <div className="grid">{chart}{device}{energySummary}{readingTable()}{todayPanel}</div>}

      {page === 'energy' && <EnergyPage readings={readings} settings={settings} now={now} onSettings={openSettings}/>}

      {page === 'sensors' && <div className="grid">
        <section className="panel sensor-panel">
          <header className="panel-head"><div><h2>DHT11</h2><p>{t.sensors.dhtSub}</p></div><span className="tag mono">GPIO 27</span></header>
          <dl className="spec-list">
            <div><dt>{t.sensors.measures}</dt><dd>{t.sensors.dhtMeasures}</dd></div>
            <div><dt>{t.sensors.accuracy}</dt><dd dir="ltr" className="mono">±2 °C · ±5 %RH</dd></div>
            <div><dt>{t.sensors.range}</dt><dd dir="ltr" className="mono">0–50 °C · 20–90 %RH</dd></div>
            <div><dt>{t.sensors.rate}</dt><dd>{t.sensors.dhtRate}</dd></div>
            <div><dt>{t.sensors.module}</dt><dd>{t.sensors.dhtModule}</dd></div>
          </dl>
        </section>
        <section className="panel sensor-panel">
          <header className="panel-head"><div><h2>CCS811</h2><p>{t.sensors.ccsSub}</p></div><span className="tag mono">I²C 0x5A</span></header>
          <dl className="spec-list">
            <div><dt>{t.sensors.measures}</dt><dd>{t.sensors.ccsMeasures}</dd></div>
            <div><dt>{t.sensors.range}</dt><dd dir="ltr" className="mono">400–8192 ppm · 0–1187 ppb</dd></div>
            <div><dt>{t.sensors.warmup}</dt><dd>{t.sensors.ccsWarmup}</dd></div>
            <div><dt>{t.sensors.note}</dt><dd>{t.sensors.ccsNote}</dd></div>
          </dl>
        </section>
        <section className="panel wiring-panel">
          <header className="panel-head"><div><h2>{t.sensors.wiring}</h2><p>{t.sensors.wiringSub}</p></div></header>
          <table className="compact">
            <thead><tr><th>{t.sensors.pin}</th><th>ESP32</th></tr></thead>
            <tbody>{wiring.map(([s, a, b]) => <tr key={s + a}><td><span className="muted">{s}</span> <span className="mono" dir="ltr">{a}</span></td><td className="mono">{b}</td></tr>)}</tbody>
          </table>
        </section>
        {chart}
      </div>}

      {page === 'history' && <div className="grid">{readingTable()}<p className="footnote span-all">{t.table.footnote}</p></div>}

      {page === 'alerts' && <div className="grid"><section className="panel alerts-panel span-all">
        <header className="panel-head">
          <div><h2>{t.alerts.log}</h2><p>{t.alerts.logSub}</p></div>
          <div className="head-actions">
            {mode === 'demo' && <button className="button" onClick={() => { setDemo(p => [...p, { ...p.at(-1)!, id: `demo-sim-${Date.now()}`, timestamp: Date.now(), temperature: settings.temperatureMax + 2 }]); notify(t.toast.simulated); }}>{t.alerts.simulate}</button>}
            <button className="button" disabled={!unread} onClick={() => { setLastReadAlert(Date.now()); notify(t.toast.marked); }}><Check size={16}/>{t.alerts.markRead}</button>
          </div>
        </header>
        {alerts.length ? <ul className="alert-list">{alerts.map(r => <li key={r.id} className={r.timestamp > lastReadAlert ? 'unread' : ''}>
          <CircleAlert size={18}/>
          <div><h3>{t.alerts.title[metrics.find(m => exceeds(m, r[m], settings)) ?? 'temperature']}</h3>
            <p>{metrics.map(m => <span key={m} className={exceeds(m, r[m], settings) ? 'over' : ''}>{t.metric[m].short} <b className="mono" dir="ltr">{fmt(m, r[m])} {metricInfo[m].unit}</b></span>)}</p></div>
          <time className="mono" dir="ltr">{new Date(r.timestamp).toLocaleDateString('en-GB')} {timeFormat(r.timestamp)}</time>
        </li>)}</ul> : <div className="empty-state">
          <h3>{t.alerts.none}</h3><p>{t.alerts.allWithin}</p>
          <button className="button" onClick={openSettings}><Settings2 size={16}/>{t.alerts.editLimits}</button>
        </div>}
      </section><p className="footnote span-all">{t.alerts.footnote}</p></div>}

      {page === 'settings' && <div className="grid"><section className="panel span-all form-page"><form onSubmit={e => { e.preventDefault(); if (viewer) return; savePrefs({ settings: draft }); setSettings(draft); notify(t.toast.settingsSaved); }}>
      {viewer && <p className="readonly-note" role="note"><Lock size={15}/>{t.set.viewOnly}</p>}
      <fieldset disabled={viewer}><legend>{t.set.device}</legend><div className="form-grid">
        <label>{t.set.deviceName}<input required maxLength={48} value={draft.deviceName} onChange={e => setDraft({ ...draft, deviceName: e.target.value })}/></label>
        <label>{t.set.room}<input required maxLength={32} value={draft.room} onChange={e => setDraft({ ...draft, room: e.target.value })}/></label>
        <div className="fixed-setting"><span>{t.set.schedule}</span><b>{t.status.fixedEvery}</b><small className="muted">{t.set.scheduleNote}</small></div>
      </div></fieldset>
      <fieldset disabled={viewer}><legend>{t.set.limits}</legend><p className="hint">{t.set.limitsHint}</p><div className="form-grid">
        {metrics.map(m => { const [min, max, step] = limitRange[m]; return <label key={m}>{t.set.max(t.metric[m].short, metricInfo[m].unit)}
          <input type="number" required min={min} max={max} step={step} value={draft[limitKey[m]] as number} onChange={e => setDraft({ ...draft, [limitKey[m]]: +e.target.value })}/></label>; })}
      </div></fieldset>
      <fieldset disabled={viewer}><legend>{t.set.energy}</legend><p className="hint">{t.set.energyHint}</p>
        <div className="part-checks">{parts.map(p => <label key={p.id}><input type="checkbox" checked={draft.parts.includes(p.id)}
          onChange={e => setDraft({ ...draft, parts: e.target.checked ? [...draft.parts, p.id] : draft.parts.filter(id => id !== p.id) })}/>
          <span><b>{t.parts[p.id].name}</b><small>{t.parts[p.id].role}</small></span></label>)}</div>
        <div className="form-grid">
          <label>{t.set.supply}<input type="number" required min="3" max="24" step="0.1" value={draft.supplyVoltage} onChange={e => setDraft({ ...draft, supplyVoltage: +e.target.value })}/></label>
          <label>{t.set.tariff}<input type="number" required min="0" max="100" step="0.001" value={draft.tariff} onChange={e => setDraft({ ...draft, tariff: +e.target.value })}/></label>
          <label>{t.set.currency}<SelectField label={t.set.currency} value={draft.currency}
            onChange={c => setDraft({ ...draft, currency: c, tariff: draft.tariff === currencies[draft.currency].tariff ? currencies[c].tariff : draft.tariff })}
            options={(['IQD', 'USD', 'MYR'] as const).map(c => [c, `${t.set.currencies[c]} (${c})`] as const)}/></label>
        </div></fieldset>
      <fieldset disabled={viewer}><legend>{t.set.privacy}</legend>
        <SwitchField checked={draft.privacyBlur} onChange={v => setDraft({ ...draft, privacyBlur: v })}>{t.set.blur}</SwitchField>
        <p className="hint">{t.set.blurHint}</p>
      </fieldset>
      {!viewer && <div className="modal-actions"><button className="button primary" type="submit">{t.set.save}</button><button className="button ghost" type="button" onClick={() => setDraft(defaults)}>{t.set.restore}</button></div>}
      </form></section></div>}

      {page === 'telegram' && canManage(user) && <div className="grid"><section className="panel span-all form-page">{!tg ? <p>{t.tg.loading}</p> : <form onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget), n = (k: string) => f.get(k) === '' ? null : Number(f.get(k));
      tgRequest('/api/alerts', 'PUT', {
        enabled: tgEnabled, lang, ...(tgToken ? { token: tgToken } : {}),
        templates: { alert: tpl.alert.trim() === tg.defaults.alert ? '' : tpl.alert, back: tpl.back.trim() === tg.defaults.back ? '' : tpl.back }, chatId: String(f.get('chatId') || ''), cooldownMin: Number(f.get('cooldownMin')),
        limits: Object.fromEntries(metrics.map(m => [m, { min: n(`${m}-min`), max: n(`${m}-max`) }])),
        ntfy: { enabled: nt.enabled, server: nt.server, topic: nt.topic, priority: nt.priority, ...(nt.token ? { token: nt.token } : {}) },
      }, t.toast.tgSaved);
    }}>
      <SwitchField checked={tgEnabled} onChange={setTgEnabled}>{t.tg.enable}</SwitchField>
      <p className="hint tg-hint">{tg.configured ? t.tg.linked : t.tg.notLinked} {t.tg.howTo}</p>
      <fieldset><legend>{t.tg.link}</legend><div className="form-grid">
        <label>{t.tg.token}<input type="password" dir="ltr" autoComplete="off" placeholder={tg.configured ? t.tg.tokenKept : '123456:ABC…'} value={tgToken} onChange={e => setTgToken(e.target.value)}/></label>
        <label>{t.tg.chatId}<SecretInput label={t.tg.chatId} name="chatId" dir="ltr" defaultValue={tg.chatId}/></label>
        <label>{t.tg.cooldown}<input name="cooldownMin" type="number" min="0" max="1440" required defaultValue={tg.cooldownMin}/></label>
      </div></fieldset>
      <fieldset className="ntfy-box"><legend>{t.ntfy.legend}</legend>
        <p className="hint">{t.ntfy.hint}</p>
        <SwitchField checked={nt.enabled} onChange={v => setNt({ ...nt, enabled: v, topic: v && !nt.topic ? randomTopic() : nt.topic })}>{t.ntfy.enable}</SwitchField>
        <div className="form-grid">
          <label>{t.ntfy.topic}
            <span className="pw-row"><input dir="ltr" autoComplete="off" spellCheck={false} maxLength={64} value={nt.topic} disabled={tg.ntfy.fromEnv} onChange={e => setNt({ ...nt, topic: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} placeholder="kelvin-…"/></span>
            <button type="button" className="text-button" onClick={() => setNt({ ...nt, topic: randomTopic() })}>{t.ntfy.newTopic}</button></label>
          <label>{t.ntfy.priority}<SelectField label={t.ntfy.priority} value={nt.priority} onChange={v => setNt({ ...nt, priority: v })}
            options={(['default', 'high', 'urgent'] as const).map(p => [p, t.ntfy.levels[p]] as const)}/></label>
          <label>{t.ntfy.server}<input dir="ltr" type="url" value={nt.server} onChange={e => setNt({ ...nt, server: e.target.value })}/></label>
          <label>{t.ntfy.token}<input dir="ltr" type="password" autoComplete="off" placeholder={tg.ntfy.hasToken ? t.tg.tokenKept : t.ntfy.tokenOptional} value={nt.token} onChange={e => setNt({ ...nt, token: e.target.value })}/></label>
        </div>
        {nt.topic && <div className="ntfy-subscribe">
          <p>{t.ntfy.subscribe}</p>
          <code dir="ltr">{nt.server.replace(/^https:\/\//, '')}/{nt.topic}</code>
          <a className="doc-link" href={`${nt.server}/${nt.topic}`} target="_blank" rel="noreferrer">{t.ntfy.openWeb}<ExternalLink size={14}/></a>
          <p className="hint">{t.ntfy.private}</p>
        </div>}
      </fieldset>
      <fieldset><legend>{t.tg.range}</legend><div className="form-grid">
        {metrics.map(m => <div key={m} className="form-grid limit-pair">
          <label>{t.tg.min(t.metric[m].short, metricInfo[m].unit)}<input name={`${m}-min`} type="number" step="0.1" defaultValue={tg.limits[m]?.min ?? ''}/></label>
          <label>{t.tg.max(t.metric[m].short, metricInfo[m].unit)}<input name={`${m}-max`} type="number" step="0.1" defaultValue={tg.limits[m]?.max ?? ''}/></label>
        </div>)}
      </div></fieldset>
      <fieldset><legend>{t.tpl.legend}</legend><p className="hint">{t.tpl.hint}</p>
        <div className="tag-row" role="group" aria-label={t.tpl.legend}>{tg.placeholders.map(k => <button key={k} type="button" className="tag-chip" onClick={() => insertTag(k)}>
          <code dir="ltr">{`{${k}}`}</code><span>{t.tpl.tags[k]}</span></button>)}</div>
        {(['alert', 'back'] as const).map(kind => <div key={kind} className="tpl-field">
          <label htmlFor={`tpl-${kind}`}>{t.tpl[kind]}</label>
          <textarea id={`tpl-${kind}`} rows={kind === 'alert' ? 6 : 2} dir={t.dir} maxLength={1000} value={tpl[kind]} ref={el => { tplRefs.current[kind] = el; }}
            onFocus={() => setTplFocus(kind)} onChange={e => setTpl({ ...tpl, [kind]: e.target.value })}/>
          <div className="tpl-foot">
            <button type="button" className="text-button" disabled={tpl[kind] === tg.defaults[kind]} onClick={() => setTpl({ ...tpl, [kind]: tg.defaults[kind] })}>{t.tpl.restore}</button>
            <span className="muted mono" dir="ltr">{tpl[kind].length} / 1000</span>
          </div>
          <div className="tg-preview" aria-label={t.tpl.preview}><span className="tg-preview-label">{t.tpl.preview}</span>
            <p>{fill(tpl[kind], kind === 'back' ? { ...t.tpl.sample, state: '', limit: '' } : t.tpl.sample)}</p></div>
        </div>)}
      </fieldset>
      <div className="modal-actions"><button className="button primary" type="submit" disabled={tgBusy}>{t.tg.save}</button><button className="button ghost" type="button" disabled={tgBusy || !tg.configured} onClick={() => tgRequest('/api/alerts/test', 'POST', { channel: 'telegram' }, t.toast.tgTest)}>{t.tg.test}</button>
        <button className="button ghost" type="button" disabled={tgBusy || !tg.ntfy.enabled || !tg.ntfy.topic} title={!tg.ntfy.enabled ? t.ntfy.saveFirst : undefined} onClick={() => tgRequest('/api/alerts/test', 'POST', { channel: 'ntfy' }, t.ntfy.testSent)}>{t.ntfy.test}</button></div>
      </form>}</section></div>}

      {page === 'connect' && <div className="grid"><section className="panel span-all form-page">
      <div className="mode-options" role="radiogroup" aria-label={t.conn.title}>
        <button role="radio" aria-checked={mode === 'demo'} onClick={() => chooseMode('demo')}><strong>{t.status.demo}</strong><span>{t.conn.demoDesc}</span></button>
        <button role="radio" aria-checked={mode === 'live'} onClick={() => chooseMode('live')}><strong>{t.conn.live}</strong><span>{t.conn.liveDesc}</span></button>
      </div>
      <ConnectGuide apiUrl={apiUrl} user={user} notify={notify} onShowLive={() => { chooseMode('live'); navigate('overview'); }}/>
      <details className="sources request-format"><summary>{t.conn.head}</summary>
        <p>{t.conn.text}</p>
        <code className="endpoint" dir="ltr">POST <Secret label={t.secret.address}>{apiUrl}</Secret></code>
        <pre dir="ltr">{JSON.stringify({ temperature: 26, humidity: 58, eco2: 612, tvoc: 37, deviceId: 'ESP32-WROOM-32', rssi: -54, uptime: 3600 }, null, 2)}</pre>
        <p className="hint">{t.conn.hint}</p>
      </details>
      <div className="modal-actions"><button className="button ghost" onClick={() => navigate('overview')}>{t.conn.back}</button></div>
      </section></div>}

      {page === 'guide' && <div className="grid"><section className="panel span-all form-page">
      <ol className="guide-list">{t.guideSteps.map(s => <li key={s.h}><h3>{s.h}</h3><p>{s.p}</p></li>)}</ol>
      <h3 className="sub-head">{t.guideDocs}</h3>
      <div className="doc-links">
        <a className="doc-link" href="https://learn.adafruit.com/dht" target="_blank" rel="noreferrer">DHT11 — Adafruit<ExternalLink size={14}/></a>
        <a className="doc-link" href="https://learn.adafruit.com/adafruit-ccs811-air-quality-sensor" target="_blank" rel="noreferrer">CCS811 — Adafruit<ExternalLink size={14}/></a>
      </div>
      <p className="guide-credit">{APP_NAME} · {t.designedBy}: <b lang="en">{STUDENT}</b></p>
      <div className="modal-actions"><button className="button primary" onClick={openConnect}>{t.device.setup}</button><button className="button ghost" onClick={() => navigate('overview')}>{t.closeGuide}</button></div>
      </section></div>}

      <footer className="page-foot">
        <span>{mode === 'demo' ? t.foot.demo : connected ? t.foot.connected : t.foot.waiting}</span>
        <span>{t.designedBy}: <b lang="en">{STUDENT}</b></span>
        <span>ESP32 · DHT11 · CCS811</span>
      </footer>
    </main>

    {toast && <div className="toast" role="status"><Check size={16}/>{toast}<button onClick={() => setToast('')} aria-label={t.close}><X size={14}/></button></div>}
  </div></TooltipProvider></I18n.Provider>;
}

export default App;
