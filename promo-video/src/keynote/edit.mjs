// The keynote film: calm, Apple-style. 90 BPM (1 beat = 20 frames, 1 bar = 80 frames at 30 fps);
// every shot is a whole number of bars, so cuts and music meet. Footage plays near natural speed.
// A highlight ("focus") belongs to a moment in the recording — it opens and closes inside that
// moment, so it can never stay on screen after the page has moved on.
export const FPS = 30, BEAT = 20, BAR = 80, INTRO = 330;

// A 4K recording is made in slow motion (timeline.slowmo) at 3840 px wide: bring its clock back
// to real time and its coordinates to the 1920 px frame of the film, so the edit stays the same.
export function normTL(TL) {
  if (TL.normalized) return TL;
  const K = TL.slowmo || 1, desk = TL.segments.find(s => s.name === 'desktop'), q = 1920 / (desk?.w || 1920);
  const t0 = Math.min(...TL.segments.map(s => s.start)), vt = t => t0 + (t - t0) / K;
  const xy = v => (typeof v === 'number' ? v * q : v);
  return {
    ...TL, normalized: true,
    segments: TL.segments.map(s => ({ ...s, start: vt(s.start), end: vt(s.end), frames: s.frames.map(f => ({ ...f, t: vt(f.t) })) })),
    events: TL.events.map(e => ({ ...e, t: vt(e.t),
      ...(e.seg !== 'phone' && e.x != null ? { x: xy(e.x), y: xy(e.y) } : {}),
      ...(e.rects ? { rects: Object.fromEntries(Object.entries(e.rects).map(([k, r]) => [k, r && r.map(xy)])) } : {}) })),
  };
}

export function buildEdit(TL) {
  TL = normTL(TL);
  const desk = TL.segments.find(s => s.name === 'desktop'), phone = TL.segments.find(s => s.name === 'phone');
  const marks = Object.fromEntries(TL.events.filter(e => e.type === 'mark').map(e => [e.name, e]));
  const at = (name, off = 0) => (name === 'END' ? desk.end : marks[name].t) + off * 1000;
  const rect = spec => { if (!spec) return null; if (Array.isArray(spec)) return spec; const [m, k] = spec.split('.'); return marks[m]?.rects?.[k] ?? null; };
  const shots = []; let f = INTRO;
  const add = (type, bars, o = {}) => { shots.push({ type, f0: f, len: bars * BAR, ...o }); f += bars * BAR; };
  const card = (eyebrow, line1, line2) => add('card', 1, { eyebrow, line1, line2 });
  // footage from [m1+o1, m2+o2], fitted to whole bars; focus: [mark, offset s, duration s, rect, text, sub]
  const app = (from, to, o = {}) => {
    const a = at(...from), b = at(...to), secs = (b - a) / 1000;
    const bars = o.bars ?? Math.max(1, Math.round(secs * FPS / BAR));
    const focus = (o.focus ?? []).map(([m, off, dur, spec, text, sub]) => ({ at: at(m, off), dur: dur * 1000, rect: rect(spec), text, sub })).filter(x => x.rect);
    add('app', bars, { src: [a, b], focus, cap: o.cap, mail: o.mail && { ...o.mail, at: at(o.mail.mark, o.mail.off), until: at(o.mail.mark, o.mail.off + o.mail.dur) } });
  };
  const image = (src, bars, o = {}) => add('image', bars, { src, size: o.size ?? [1920, 1080], pan: o.pan, focus: o.focus ?? [], cap: o.cap });

  // 01 — Accounts
  card('Accounts', 'Sign up in seconds.', 'Confirmed by email.');
  app(['signin', 0], ['signup-strength', 0], { bars: 2, cap: 'Create your own account.', focus: [['signup', 0.4, 2.2, 'signup.card', 'Your name, email and a password.']] });
  app(['signup-strength', 0], ['first-dash', 1.0], { bars: 2, cap: 'Confirm with a code from your email.', mail: { mark: 'confirm', off: 0.3, dur: 2.6 }, focus: [['confirm', 1.2, 1.7, 'confirm.field', 'Six digits. Valid for ten minutes.']] });
  // 02 — Dashboard
  card('Dashboard', 'Everything,', 'at a glance.');
  app(['overview', 0], ['chart-hover', 0], { bars: 2, cap: 'Live readings from the fridge.', focus: [['overview', 0.3, 1.6, 'overview.status', 'Live from the ESP32.', 'A reading saved every minute.'], ['overview', 2.2, 1.6, 'overview.cards', 'Four sensors. Your limits.']] });
  app(['chart-hover', 0], ['chart-7d', 0], { bars: 2, cap: 'Every moment, on one chart.', focus: [['chart-hover', 0.3, 2.0, 'chart-hover.chart', 'Hover to see any moment.'], ['chart-forecast', 0.2, 2.3, 'chart-forecast.chart', 'And a forecast for the next six hours.']] });
  app(['chart-7d', 0], ['energy', 0], { bars: 2, cap: 'From one day to a whole week.', focus: [['chart-7d', 0.3, 2.3, 'chart-7d.chart', 'Up to seven days.'], ['chart-compare', 0.3, 2.2, 'chart-compare.chart', 'Compared with the period before.']] });
  // 03 — Energy
  card('Energy', 'Power,', 'worked out for you.');
  app(['energy', 0], ['energy-hourly', 2.0], { bars: 3, cap: 'No power sensor needed.', focus: [['energy-mah', 0.3, 1.7, 'energy-mah.cards', 'In watt-hours or milliamp-hours.'], ['energy-parts', 0.2, 1.5, 'energy-parts.table', 'Every part, from its datasheet.'], ['energy-hourly', 0.2, 1.6, 'energy-hourly.bars', 'Hour by hour.']] });
  app(['sensors', 0.3], ['sensors', 3.2], { bars: 1, cap: 'Sensor specs and wiring, built in.' });
  // 04 — Data
  card('Data', 'Take your readings', 'anywhere.');
  app(['log', 0], ['excel', 2.8], { bars: 3, cap: 'Search every reading. Export in one click.', focus: [['log-search', 0.3, 1.7, 'log-search.search', 'Search by time or value.'], ['excel', 0.2, 2.0, 'excel.button', 'Download Excel.']] });
  image('launch/excel-readings.png', 1, { pan: [[0, 0, 1920, 1080], [0, 40, 1500, 844]], cap: 'Every reading, neatly formatted.' });
  image('launch/excel-summary.png', 1, { pan: [[0, 40, 1500, 844], [0, 40, 1300, 731]], cap: 'A summary: minimum, average, maximum.' });
  image('launch/excel-energy.png', 2, { size: [2500, 1080], pan: [[0, 40, 1500, 844], [1000, 110, 1500, 844]], focus: [[0.1, 0.45, [0, 46, 640, 46], 'Live formulas.', 'Change the voltage and everything updates.']], cap: 'Energy, with charts.' });
  image('launch/excel-charts.png', 1, { size: [1920, 3400], pan: [[0, 60, 1920, 1080], [0, 1200, 1920, 1080]], cap: 'Charts with your limits and forecast.' });
  // 05 — Alerts
  card('Alerts', 'Know the moment', 'it matters.');
  app(['alerts', 0.4], ['alerts', 3.1], { bars: 1, cap: 'Every breach, logged.' });
  app(['channels', 0], ['template-live', 2.6], { bars: 3, cap: 'Alerts, written your way.', focus: [['ntfy', 0.1, 1.4, 'ntfy.topic', 'Free push with ntfy.'], ['template', 0.3, 2.2, 'template.area', 'Write your own message.'], ['template-live', 0.2, 2.2, 'template-live.preview', 'And see it, live.']] });
  add('telegram', 2, { cap: 'Delivered to Telegram, instantly.' });
  // 06 — Account
  card('Your account', 'Thoughtful,', 'down to the details.');
  app(['account', 0], ['photo-crop', 0], { bars: 2, cap: 'Badges for the way you use it.', focus: [['badges', 0.3, 2.3, 'badges.badges', 'Twelve badges to earn.']] });
  app(['photo-crop', 0], ['privacy', 2.6], { bars: 3, cap: 'Make it yours. Keep it private.', focus: [['photo-crop', 0.2, 1.9, 'photo-crop.dialog', 'A profile photo, cropped to fit.'], ['photo-done', 0.4, 1.3, 'photo-done.profile', 'Another badge earned.'], ['privacy', 0.4, 1.8, 'privacy.profile', 'Private details stay blurred.', 'Until you tap the eye.']] });
  app(['twostep', 0], ['lock-keys', 0], { bars: 2, cap: 'Two-step sign-in, by email.', mail: { mark: 'twostep', off: 0.6, dur: 2.6 } });
  app(['lock-keys', 0], ['unlocked', 0.8], { bars: 3, cap: 'Ctrl + Shift + L locks the screen.' });
  // 07 — Teams
  card('Teams', 'Built for everyone', 'in the lab.');
  app(['users', 0], ['audit', 3.5], { bars: 3, cap: 'Invite people. See everything that happens.', focus: [['invite', 0.3, 2.0, 'invite.form', 'Invite with a role.', 'Admin, operator or viewer.'], ['audit', 0.4, 2.3, 'audit.cards', 'Every sign-in, recorded.']] });
  // 08 — Help
  card('Help', 'Help, right where', 'you need it.');
  app(['system', 0], ['guide', 2.2], { bars: 3, cap: 'How it works — live.', focus: [['system', 0.3, 2.3, 'system.diagram', 'The whole system, and its status.']] });
  app(['support', 0], ['connect', 0], { bars: 2, cap: 'Something wrong? Tell IT in a sentence.', focus: [['support-typed', 0.2, 2.2, 'support-typed.form', 'Straight to the IT team.']] });
  app(['connect', 0], ['connect-code-more', 1.6], { bars: 3, cap: 'Connect the ESP32, step by step.', focus: [['connect', 0.3, 2.0, 'connect.steps', 'Six steps, from parts to readings.'], ['connect-code', 0.3, 1.9, 'connect-code.code', 'The code is written for you.']] });
  app(['settings', 0], ['dark', 0], { bars: 2, cap: 'Your limits. Your parts. Your prices.', focus: [['settings', 0.4, 2.0, 'settings.form', 'All in one place.']] });
  // 09 — Languages
  card('Languages', 'Speaks', 'your language.');
  app(['dark', 0], ['arabic', 2.4], { bars: 2, cap: 'Light or dark. العربية, right to left.' });
  app(['arabic', 2.4], ['END', 0], { bars: 2, cap: 'Bahasa Melayu, too.' });
  if (phone) add('phone', 3, { src: [phone.start, phone.end] });
  // 10 — Why
  card('Under the hood', 'Why we built it', 'this way.');
  for (const it of TECH) add('tech', 2, { item: it, index: TECH.indexOf(it) });
  // The ending.
  add('scene', 4, { from: 71.0, to: 81.0 });

  const sec = fr => fr / FPS;
  const clicks = [];
  for (const s of shots.filter(s => s.type === 'app')) {
    const [a, b] = s.src;
    for (const e of TL.events) if (e.type === 'click' && e.seg === 'desktop' && e.x && e.t >= a && e.t < b) clicks.push(sec(s.f0 + (e.t - a) / (b - a) * s.len));
  }
  const mailAt = shots.filter(s => s.mail).map(s => sec(s.f0 + (s.mail.at - s.src[0]) / (s.src[1] - s.src[0]) * s.len));
  return {
    shots, frames: f, desk, phone,
    cues: { total: sec(f), introEnd: sec(INTRO), shots: shots.map(s => ({ type: s.type, t0: sec(s.f0), t1: sec(s.f0 + s.len) })), clicks, mails: mailAt },
  };
}

export const TECH = [
  { name: 'ESP32, DHT11 and CCS811', why: 'Wi-Fi built in and low power. Temperature and humidity, plus eCO₂ and TVOC — the gases that rise as food spoils.' },
  { name: 'React and TypeScript', why: 'One fast app for desktop and phone. Three languages, light and dark, and it installs like an app.' },
  { name: 'Node.js on Vercel', why: 'The same server code runs on a laptop and in the cloud. HTTPS, a new deploy on every push, no server to look after.' },
  { name: 'Supabase PostgreSQL', why: 'A real SQL database. Every reading kept, week-long averages in one query, shared by every copy of the server.' },
  { name: 'Telegram, ntfy and email', why: 'Alerts on any phone, for free. Codes by email for new accounts and for two-step sign-in.' },
  { name: 'Security by default', why: 'Hashed passwords, an encrypted vault, device keys, a security log and a strict content policy.' },
];
