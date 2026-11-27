// Records the full Kelvin walkthrough for the launch video. Every feature gets a marker with
// the on-screen boxes of the elements to highlight, so the edit can cut on the beat and zoom.
// node record2.cjs <playwright> <port>
const { chromium } = require(process.argv[2]);
const fs = require('fs'), path = require('path');
const PORT = process.argv[3] || 5412, BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, 'rec'), MAIL = path.join(__dirname, 'mail');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEBSITE = 'C:/Users/Ali PC/Desktop/iot/Mini Project/website';
const EMAIL = 'ali@kelvin.test', NAME = 'Ali Ahmed';
const PW = 'Film-' + Math.random().toString(36).slice(2, 10) + '!4';
fs.writeFileSync(path.join(__dirname, 'pw2.txt'), PW); // throwaway, local test account only
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

const timeline = { segments: [], events: [], mails: [] };
const ev = (type, d = {}) => timeline.events.push({ t: Date.now(), type, ...d });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let frameNo = 0;
const mailCount = () => fs.readdirSync(MAIL).length;
async function waitMail(n0) { for (let i = 0; i < 60 && mailCount() <= n0; i++) await sleep(150); const f = fs.readdirSync(MAIL).sort().at(-1); return fs.readFileSync(path.join(MAIL, f), 'latin1'); }
const codeOf = eml => (eml.match(/(\d{3}) (\d{3})/) || []).slice(1).join('');

async function screencast(page, name, size) {
  const cdp = await page.context().newCDPSession(page);
  const seg = { name, w: size.w, h: size.h, frames: [], start: Date.now() }; timeline.segments.push(seg);
  cdp.on('Page.screencastFrame', async f => {
    const file = `f${String(++frameNo).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, 'frames', file), Buffer.from(f.data, 'base64'));
    seg.frames.push({ file, t: Math.round(f.metadata.timestamp * 1000) });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: size.w, maxHeight: size.h, everyNthFrame: 1 });
  return async () => { await cdp.send('Page.stopScreencast').catch(() => {}); seg.end = Date.now(); };
}
async function shots(page, name, size) {
  const cdp = await page.context().newCDPSession(page);
  const seg = { name, w: size.w, h: size.h, frames: [], start: Date.now() }; timeline.segments.push(seg);
  let on = true;
  const loop = (async () => { while (on) { const t = Date.now();
    const vv = (await cdp.send('Page.getLayoutMetrics').catch(() => null))?.cssVisualViewport ?? { pageX: 0, pageY: 0 };
    const vp = page.viewportSize();
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, clip: { x: vv.pageX, y: vv.pageY, width: vp.width, height: vp.height, scale: size.w / vp.width } }).catch(() => null);
    if (r) { const file = `f${String(++frameNo).padStart(5, '0')}.jpg`; fs.writeFileSync(path.join(OUT, 'frames', file), Buffer.from(r.data, 'base64')); seg.frames.push({ file, t }); }
    const w = 70 - (Date.now() - t); if (w > 0) await sleep(w); } })();
  return async () => { on = false; await loop; seg.end = Date.now(); };
}
function mouse(page, seg, scale = 1) {
  let x = 960, y = 540;
  const m = {
    async to(tx, ty, ms = 450) { const sx = x, sy = y, n = Math.max(6, Math.round(ms / 16)), t0 = Date.now();
      for (let i = 1; i <= n; i++) { const k = i / n, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; x = sx + (tx - sx) * e; y = sy + (ty - sy) * e;
        await page.mouse.move(x, y); ev('cursor', { seg, x: x * scale, y: y * scale }); const w = t0 + ms * i / n - Date.now(); if (w > 0) await sleep(w); } },
    async toEl(loc, ms, dx = 0.5, dy = 0.5) { const b = await loc.boundingBox(); if (b) await m.to(b.x + b.width * dx, b.y + b.height * dy, ms); },
    async click(loc, ms = 450) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await m.toEl(loc, ms); await sleep(90); ev('click', { seg, x: x * scale, y: y * scale }); await page.mouse.down(); await sleep(60); await page.mouse.up(); },
  };
  return m;
}
async function box(loc) { try { const b = await loc.first().boundingBox(); return b ? [b.x, b.y, b.width, b.height].map(Math.round) : null; } catch { return null; } }
async function mark(page, name, rects = {}) { const r = {}; for (const [k, loc] of Object.entries(rects)) r[k] = await box(typeof loc === 'string' ? page.locator(loc) : loc); ev('mark', { name, rects: r }); console.log('mark', name); }
async function step(name, fn) { try { await fn(); } catch (e) { console.log('WARN', name, e.message.split('\n')[0]); ev('warn', { name }); } }

(async () => {
  const send = (t = 4.3) => fetch(`${BASE}/api/readings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ temperature: +(t + Math.random() * 0.4).toFixed(1), humidity: +(65 + Math.random() * 3).toFixed(1), eco2: 480 + Math.round(Math.random() * 30), tvoc: 17 + Math.round(Math.random() * 6), rssi: -54, uptime: 3 * 86400 + 15000 }) }).catch(() => {});
  await send(); const ticker = setInterval(send, 60000);
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-GB', timezoneId: 'Asia/Kuala_Lumpur', colorScheme: 'light', acceptDownloads: true });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('kv')) { localStorage.setItem('kelvin-lang', 'en'); localStorage.setItem('kelvin-energy-unit', 'wh'); sessionStorage.setItem('kv', '1'); } } catch {} const z = () => { if (document.documentElement) document.documentElement.style.zoom = '1.2'; }; try { z(); } catch {} document.addEventListener('DOMContentLoaded', z); });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready); await sleep(900);
  const m = mouse(page, 'desktop');
  const stop = await screencast(page, 'desktop', { w: 1920, h: 1080 });
  await sleep(300);
  const nav = async name => {
    const item = page.locator('.side-nav .nav-sub', { hasText: name }).first();
    if (!await item.isVisible()) { await m.click(page.locator('.side-nav .nav-tree', { has: page.locator('.nav-sub', { hasText: name }) }).locator('.nav-head'), 380); await sleep(250); }
    await m.click(item, 420); await sleep(650); await page.evaluate(() => window.scrollTo({ top: 0 }));
  };
  const wheel = async (dy, n = 1, gap = 500) => { for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await sleep(gap); } };

  // ---- Sign up, with the emailed code ----
  await mark(page, 'signin', { card: '.auth-card', hero: '.auth-stage' }); await sleep(1500);
  await step('signup', async () => {
    await m.click(page.getByRole('tab', { name: 'Create account' }), 600); await sleep(400);
    await mark(page, 'signup', { card: '.auth-card' });
    await m.click(page.getByLabel('Name'), 400); await page.keyboard.type(NAME, { delay: 35 });
    await m.click(page.locator('input[type=email]'), 350); await page.keyboard.type(EMAIL, { delay: 30 });
    await m.click(page.locator('input[autocomplete=new-password]'), 350); await page.keyboard.type(PW, { delay: 30 });
    await mark(page, 'signup-strength', { meter: '.pw-meter', note: '.first-note' }); await sleep(500);
    const n0 = mailCount(); await m.click(page.locator('.auth-submit'), 400);
    await page.waitForSelector('.otp-card', { timeout: 10000 }); const eml = await waitMail(n0); await sleep(500);
    timeline.mails.push({ kind: 'signup', code: codeOf(eml) });
    await mark(page, 'confirm', { card: '.otp-card', field: '.otp-field' }); await sleep(1400);
    await page.keyboard.type(codeOf(eml), { delay: 110 });
    await page.waitForSelector('.strip-chart', { timeout: 15000 }); await sleep(900);
  });
  await mark(page, 'first-dash'); await sleep(600);
  // The real setup: live device, a fridge limit of 8 °C.
  await page.evaluate(() => fetch('/api/me/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'live', lang: 'en', settings: { deviceName: 'ESP32-WROOM-32', room: 'Lab fridge · USM', temperatureMax: 8, humidityMax: 90, eco2Max: 1000, tvocMax: 500, supplyVoltage: 5, tariff: 0.27, currency: 'MYR', privacyBlur: true, parts: ['esp32', 'wifi', 'board', 'dht11', 'ccs811', 'oled'] } }) }));
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.strip-chart'); await sleep(1200);

  // ---- Overview ----
  await mark(page, 'overview', { status: '.status-strip', cards: '.readouts', chart: '.chart-panel', device: '.panel:has-text("Board")' });
  await m.toEl(page.locator('.status-strip'), 600, 0.25); await sleep(900);
  for (let i = 0; i < 4; i++) { await m.toEl(page.locator('.readouts .metric-card').nth(i), 330, 0.5, 0.4); await sleep(250); }
  await step('chart', async () => {
    const sc = await page.locator('.strip-chart').first().boundingBox();
    await mark(page, 'chart-hover', { chart: '.chart-panel' });
    await m.to(sc.x + sc.width * 0.1, sc.y + 130, 450); await m.to(sc.x + sc.width * 0.8, sc.y + 140, 2000);
    await mark(page, 'chart-forecast', { chart: '.chart-panel' }); await m.to(sc.x + sc.width * 0.95, sc.y + 140, 900); await sleep(500);
    await m.click(page.getByRole('radio', { name: '7 days' }), 500); await sleep(700); await mark(page, 'chart-7d', { chart: '.chart-panel' });
    await m.to(sc.x + sc.width * 0.3, sc.y + 250, 400); await m.to(sc.x + sc.width * 0.75, sc.y + 260, 1200);
    await m.click(page.getByRole('radio', { name: '24 hours' }), 500);
    const cmp = page.locator('.cmp-select').first(); await m.toEl(cmp, 400); ev('click', { seg: 'desktop', x: 0, y: 0, at: 'cmp' }); await cmp.selectOption({ label: 'Previous period' }); await sleep(400);
    await mark(page, 'chart-compare', { chart: '.chart-panel' }); await sleep(1600); await cmp.selectOption({ label: 'No comparison' });
  });

  // ---- Energy ----
  await step('energy', async () => {
    await nav('Energy'); await mark(page, 'energy', { cards: '.energy-readouts', units: '.energy-units' }); await sleep(900);
    await m.click(page.getByRole('radio', { name: /mAh/ }), 500); await sleep(500); await mark(page, 'energy-mah', { cards: '.energy-readouts' }); await sleep(1300);
    await m.to(1000, 700, 300); await wheel(560, 1, 700); await mark(page, 'energy-parts', { table: '.breakdown-panel' }); await sleep(1200);
    await wheel(560, 1, 700); await mark(page, 'energy-hourly', { bars: '.hour-bars', method: '.method-panel' }); await sleep(1100);
    await m.click(page.getByRole('radio', { name: /Wh/ }).first(), 300).catch(() => {});
  });
  // ---- Sensors ----
  await step('sensors', async () => { await nav('Sensors'); await mark(page, 'sensors'); await sleep(900); await m.to(1000, 700, 300); await wheel(500, 2, 650); });
  // ---- Readings log, search, Excel ----
  await step('log', async () => {
    await nav('Readings log'); await mark(page, 'log', { table: 'table' }); await sleep(800);
    const search = page.locator('input[type=search], .search-box input, input[placeholder*="Search"]').first();
    await m.click(search, 450); await page.keyboard.type('8.', { delay: 140 }); await sleep(500); await mark(page, 'log-search', { table: 'table', search: search }); await sleep(1100);
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await sleep(300);
    const excel = page.locator('button', { hasText: 'Excel' }).first();
    await m.toEl(excel, 500); await mark(page, 'excel', { button: excel }); await sleep(300);
    ev('click', { seg: 'desktop', x: (await excel.boundingBox()).x + 60, y: (await excel.boundingBox()).y + 18 });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), excel.click()]);
    await dl.saveAs(path.join(__dirname, 'kelvin-readings.xlsx')); await sleep(1200);
  });
  // ---- Alerts and alert channels (the message editor) ----
  await step('alerts', async () => { await nav('Alerts'); await mark(page, 'alerts', { log: '.panel' }); await sleep(1500); });
  await step('channels', async () => {
    await nav('Alert channels'); await mark(page, 'channels', { panel: '.panel' }); await sleep(800);
    const ntfy = page.locator('label, .switch-field, button[role=switch]', { hasText: 'Send alerts to ntfy too' }).first();
    await m.click(ntfy, 500).catch(() => {}); await sleep(700); await mark(page, 'ntfy', { topic: 'input[placeholder^="kelvin"], input[value^="kelvin-"]' }); await sleep(800);
    const ta = page.locator('textarea').first(); await ta.scrollIntoViewIfNeeded(); await sleep(300);
    await page.evaluate(() => window.scrollBy({ top: 900 })); await sleep(400);
    await mark(page, 'template', { area: ta, preview: page.locator('text=Preview').first() });
    await m.click(ta, 400); await page.keyboard.press('Control+End'); await page.keyboard.type(' · Lab fridge', { delay: 45 }); await sleep(350);
    const tag = page.locator('button', { hasText: '{time}' }).first(); await m.click(tag, 450).catch(() => {}); await sleep(600);
    await mark(page, 'template-live', { area: ta, preview: page.locator('text=Preview').first() }); await sleep(1500);
  });
  // ---- My account: badges, photo, privacy, two-step, lock screen ----
  await step('account', async () => {
    await m.click(page.locator('.user-chip'), 500); await sleep(700); await page.evaluate(() => window.scrollTo({ top: 0 }));
    await mark(page, 'account', { profile: '.panel', badges: '.panel:has-text("Badges")' }); await sleep(900);
    await m.toEl(page.locator('.panel:has-text("Badges")').first(), 500, 0.3, 0.55); await mark(page, 'badges', { badges: '.panel:has-text("Badges")' }); await sleep(1500);
  });
  await step('photo', async () => {
    const add = page.locator('button', { hasText: 'Add a photo' }).first(); await m.toEl(add, 500);
    ev('click', { seg: 'desktop', x: (await add.boundingBox()).x + 50, y: (await add.boundingBox()).y + 15 });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), add.click()]);
    await chooser.setFiles(path.join(WEBSITE, 'public', 'icon-512.png')); await sleep(900);
    await mark(page, 'photo-crop', { dialog: '[role=dialog]' }); await sleep(900);
    const save = page.locator('[role=dialog] button', { hasText: /Save|Use|Done|Apply/ }).last(); await m.click(save, 500); await sleep(1200);
    await mark(page, 'photo-done', { profile: '.panel' }); await sleep(800);
  });
  await step('privacy', async () => {
    const eye = page.locator('.panel').first().locator('button[aria-label*="Show"], button[aria-label*="show"], .icon-button').first();
    await m.click(eye, 450); await sleep(500); await mark(page, 'privacy', { profile: '.panel' }); await sleep(900); await m.click(eye, 300).catch(() => {});
  });
  await step('twostep', async () => {
    const btn = page.locator('button', { hasText: 'Turn on two-step sign-in' }).first(); await btn.scrollIntoViewIfNeeded(); await sleep(400);
    await mark(page, 'twostep', { panel: page.locator('.panel:has-text("Two-step sign-in")').first() });
    const n0 = mailCount(); await m.click(btn, 500); const eml = await waitMail(n0); await sleep(700);
    timeline.mails.push({ kind: 'enable', code: codeOf(eml) });
    await mark(page, 'twostep-code', { panel: page.locator('.panel:has-text("Two-step sign-in")').first() });
    await page.keyboard.type(codeOf(eml), { delay: 110 }); await sleep(1400);
    await mark(page, 'twostep-on', { panel: page.locator('.panel:has-text("Two-step sign-in")').first() }); await sleep(900);
  });
  await step('lock', async () => {
    await mark(page, 'lock-keys', { panel: page.locator('.panel:has-text("Screen lock")').first() }); await sleep(500);
    await page.keyboard.press('Control+Shift+L'); await sleep(1300); await mark(page, 'locked', { screen: '.lock-screen' }); await sleep(1500);
    await page.keyboard.press('Space').catch(() => {}); await sleep(500);
    const pw = page.locator('.lock-screen input[type=password], .lock-screen input').first(); await m.click(pw, 500).catch(() => {});
    await page.keyboard.type(PW, { delay: 35 }); await page.keyboard.press('Enter'); await sleep(1300); await mark(page, 'unlocked'); await sleep(500);
  });
  // ---- Admin: users and the security log ----
  await step('users', async () => {
    await nav('Users'); await mark(page, 'users', { invite: '.panel', accounts: '.panel:has-text("Accounts")' }); await sleep(800);
    const inputs = page.locator('.panel').first().locator('input');
    await m.click(inputs.nth(0), 400); await page.keyboard.type('Sara Ali', { delay: 40 });
    await m.click(inputs.nth(1), 350); await page.keyboard.type('sara@kelvin.test', { delay: 30 });
    await mark(page, 'invite', { form: '.panel' }); await sleep(1200);
  });
  await step('audit', async () => { await nav('Security log'); await mark(page, 'audit', { cards: '.panel', log: 'table' }); await sleep(1200);
    await m.click(page.getByRole('button', { name: 'Sign-ins' }).first(), 450).catch(() => {}); await sleep(900); await mark(page, 'audit-filter', { log: 'table' }); await sleep(800); });
  // ---- Help ----
  await step('system', async () => { await nav('How it works'); await mark(page, 'system', { diagram: 'section.panel' }); await sleep(1600); await m.to(1000, 700, 300); await wheel(600, 1, 900); await mark(page, 'system-steps'); await sleep(1000); });
  await step('guide', async () => { await nav('User guide'); await mark(page, 'guide'); await sleep(1300); });
  await step('support', async () => { await nav('IT support'); await mark(page, 'support', { form: '.panel' }); await sleep(800);
    const ta = page.locator('textarea').first(); await m.click(ta, 400); await page.keyboard.type('The fridge door sensor shows 9 °C after lunch.', { delay: 25 }); await sleep(700); await mark(page, 'support-typed', { form: '.panel' }); await sleep(700); });
  await step('connect', async () => { await nav('Connect device'); await mark(page, 'connect', { steps: '.stepper' }); await sleep(900);
    const next = page.locator('.connect-guide button', { hasText: /^Next/ }).first();
    for (let i = 0; i < 3; i++) { if (await next.isVisible()) { await m.click(next, 380); await sleep(700); } }
    await mark(page, 'connect-code', { code: 'pre, .code-block, textarea' }); await sleep(800); await m.to(1000, 700, 300); await wheel(500, 2, 650); await mark(page, 'connect-code-more'); await sleep(600); });
  // ---- Settings ----
  await step('settings', async () => { await m.click(page.locator('.sidebar .nav-item', { hasText: 'Settings' }).first(), 450); await sleep(800); await page.evaluate(() => window.scrollTo({ top: 0 }));
    await mark(page, 'settings', { form: '.panel' }); await sleep(1200); await m.to(1000, 700, 300); await wheel(520, 1, 900); await mark(page, 'settings-energy'); await sleep(1000); });
  // ---- Dark mode and languages ----
  await step('looks', async () => {
    await nav('Overview'); await sleep(400);
    await m.click(page.locator('.sidebar .nav-item', { hasText: 'Dark mode' }), 500); await sleep(800); await mark(page, 'dark'); await sleep(1100);
    await m.click(page.locator('.sidebar .lang-switch button[lang=ar]'), 500); await sleep(900); await mark(page, 'arabic'); await sleep(1300);
    await m.click(page.locator('.sidebar .lang-switch button[lang=ms]'), 450); await sleep(800); await mark(page, 'malay'); await sleep(1100);
    await m.click(page.locator('.sidebar .lang-switch button[lang=en]'), 450); await sleep(500);
    await m.click(page.locator('.sidebar .nav-item', { hasText: 'Light mode' }), 450); await sleep(700);
  });
  await stop();

  // ---- Phone ----
  await step('phone', async () => {
    const state = await ctx.storageState();
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Kuala_Lumpur', storageState: state });
    const pp = await phone.newPage(); await pp.goto(BASE, { waitUntil: 'load' }); await pp.waitForSelector('.strip-chart', { timeout: 20000 }); await sleep(600);
    const stopP = await shots(pp, 'phone', { w: 975, h: 2110 }); ev('mark', { name: 'phone', rects: {} });
    await sleep(1200); for (let i = 0; i < 4; i++) { await pp.mouse.wheel(0, 420); await sleep(750); }
    await pp.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await sleep(800);
    const pm = mouse(pp, 'phone', 2.5); await pm.click(pp.locator('.mobile-bar .icon-button').first(), 450); await sleep(900);
    await pm.click(pp.locator('.side-nav .nav-sub', { hasText: 'Energy' }).first(), 450); await sleep(1800);
    await stopP();
  });
  clearInterval(ticker); ev('end');
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline));
  console.log('done', timeline.segments.map(s => `${s.name}: ${s.frames.length} frames ${((s.end - s.start) / 1000).toFixed(1)} s`).join(' | '), 'marks', timeline.events.filter(e => e.type === 'mark').length, 'warns', timeline.events.filter(e => e.type === 'warn').map(e => e.name).join(','));
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
