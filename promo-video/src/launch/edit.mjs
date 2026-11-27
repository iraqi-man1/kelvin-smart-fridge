// The launch film's edit: every shot is a whole number of bars at 120 BPM (1 beat = 15 frames,
// 1 bar = 60 frames at 30 fps), so cuts, zooms, notes and the score all land on the beat.
// Footage shots are cut between two markers of the recording (public/rec/timeline.json).
export const FPS = 30, BEAT = 15, BAR = 60, INTRO = 330; // the intro (0–11 s) is the cinematic opening

export function buildEdit(TL) {
  const marks = Object.fromEntries(TL.events.filter(e => e.type === 'mark').map(e => [e.name, e]));
  const desk = TL.segments.find(s => s.name === 'desktop'), phone = TL.segments.find(s => s.name === 'phone');
  const rect = spec => {
    if (!spec) return null;
    if (Array.isArray(spec)) return spec;
    if (spec.of) { const r = rect(spec.of); return r && [r[0] - spec.grow[0], r[1] - spec.grow[1], r[2] + spec.grow[0] + spec.grow[2], r[3] + spec.grow[1] + spec.grow[3]]; }
    const [m, k] = spec.split('.'); return marks[m]?.rects?.[k] ?? null;
  };
  const t = name => name === 'END' ? desk.end : marks[name]?.t;
  const shots = [];
  let f = INTRO, chapter = null;
  const add = (type, bars, o = {}) => { shots.push({ type, f0: f, len: Math.round(bars * BAR), chapter, ...o }); f += Math.round(bars * BAR); };
  const title = (num, text, sub) => { chapter = { num, text }; add('title', 1, { num, text, sub }); };
  const app = (from, to, bars, o = {}) => {
    const a = t(from), b = t(to);
    if (a == null || b == null) return console.warn('missing marker', from, to);
    add('app', bars, {
      src: [a, b],
      cam: (o.cam ?? [[0, null]]).map(([beat, s]) => ({ beat, rect: rect(s) })),
      calls: (o.calls ?? []).map(([beat, s, text, sub, end]) => ({ beat, rect: rect(s), text, sub, end })).filter(c => c.rect),
      cap: o.cap, mail: o.mail,
    });
  };
  const image = (src, bars, o = {}) => add('image', bars, { src, size: o.size ?? [1920, 1080], cam: (o.cam ?? [[0, null]]).map(([beat, r]) => ({ beat, rect: r })), calls: (o.calls ?? []).map(([beat, r, text, sub]) => ({ beat, rect: r, text, sub })), cap: o.cap });

  // 01 — Sign up
  title('01', 'Sign up in seconds', 'Your own account, confirmed by email');
  app('signin', 'signup-strength', 2, { cam: [[0, null], [4, 'signup.card']], calls: [[4, 'signup.card', 'Anyone can make an account', 'The first one becomes the admin']] });
  app('signup-strength', 'confirm', 1, { cam: [[0, 'signup.card']], calls: [[0, 'signup-strength.meter', 'Live password strength']] });
  app('confirm', 'first-dash', 2, { cam: [[0, { of: 'confirm.card', grow: [700, 60, 40, 60] }]], mail: { src: 'launch/signup.png', beat: 1, end: 6, side: 'left' }, calls: [[5, 'confirm.field', 'A 6-digit code', 'Works once · expires in 10 minutes']] });
  // 02 — Dashboard
  title('02', 'The live dashboard', 'Four sensors, one glance');
  app('overview', 'chart-hover', 2, { cam: [[0, null], [2, 'overview.status'], [5, 'overview.cards']], calls: [[2, 'overview.status', 'Live from the ESP32', 'One saved reading every minute'], [5, 'overview.cards', 'Your limits on every card']] });
  app('chart-hover', 'chart-7d', 2, { cam: [[0, 'chart-hover.chart']], calls: [[1, 'chart-hover.chart', 'Hover any moment', 'Exact values and time'], [5, 'chart-forecast.chart', 'A 6-hour forecast', 'with its 95% range']] });
  app('chart-7d', 'energy', 2, { cam: [[0, 'chart-7d.chart']], calls: [[1, 'chart-7d.chart', '24 hours · 3 days · 7 days'], [5, 'chart-compare.chart', 'Compare with the period before']] });
  // 03 — Energy & sensors
  title('03', 'Energy, without a power sensor', 'Worked out from every part’s datasheet');
  app('energy', 'energy-hourly', 2, { cam: [[0, 'energy.cards'], [5, 'energy-parts.table']], calls: [[1, 'energy.units', 'Wh or mAh — your choice'], [3, 'energy-mah.cards', 'Now · today · since power-on · per day'], [6, 'energy-parts.table', 'Every part, its current and share']] });
  app('energy-hourly', 'log', 2, { cam: [[0, null]], calls: [[0, 'energy-hourly.bars', 'Energy hour by hour']], cap: { at: 4, text: 'Sensors · specs and wiring' } });
  // 04 — Data
  title('04', 'Your data, anywhere', 'Search it. Export it.');
  app('log', 'excel', 2, { cam: [[0, null], [3, 'log-search.table']], calls: [[3, 'log-search.search', 'Search any time or value']] });
  app('excel', 'alerts', 1, { cam: [[0, null]], calls: [[1, 'excel.button', 'One click → Excel']] });
  image('launch/excel-readings.png', 1, { cam: [[0, null], [2, [0, 40, 1300, 731]]], cap: { at: 0, text: 'Readings · every row formatted' } });
  image('launch/excel-summary.png', 1, { cam: [[0, [0, 40, 1250, 703]]], cap: { at: 0, text: 'Summary · min, average, max' } });
  image('launch/excel-energy.png', 2, { size: [2500, 1080], cam: [[0, [0, 40, 1380, 776]], [4, [1060, 100, 1440, 810]]], calls: [[1, [0, 46, 640, 46], 'Live formulas', 'Change the voltage — it all recalculates']], cap: { at: 4, text: 'Energy sheet · with charts' } });
  image('launch/excel-charts.png', 1, { size: [1920, 3400], cam: [[0, [0, 60, 1920, 1080]], [2, [0, 1150, 1920, 1080]]], cap: { at: 0, text: 'Charts with your limits and forecast' } });
  // 05 — Alerts
  title('05', 'Alerts that reach you', 'The moment food is at risk');
  app('alerts', 'channels', 1, { cap: { at: 0, text: 'Every breach, logged' } });
  app('channels', 'template', 1, { calls: [[1, 'ntfy.topic', 'ntfy push — no bot needed']], cap: { at: 0, text: 'Telegram and ntfy' } });
  app('template', 'account', 2, { cam: [[0, 'template.area']], calls: [[1, 'template.area', 'Write your own alert message', 'Tags fill in the real values'], [5, 'template-live.preview', 'Live preview']] });
  add('scene', 2, { from: 51.4, to: 55.6 });
  // 06 — Account
  title('06', 'Small things you will love', 'Hidden in My account');
  app('account', 'photo-crop', 2, { cam: [[0, null], [2, 'badges.badges']], calls: [[2, 'badges.badges', '12 badges to earn', 'Days, streaks, exports — counted on the server']] });
  app('photo-crop', 'privacy', 2, { calls: [[0, 'photo-crop.dialog', 'A profile photo, cropped to a square', null, 3], [4, 'photo-done.profile', 'New badge: Face to the name']] });
  app('privacy', 'twostep', 1, { calls: [[0, 'privacy.profile', 'Private details stay blurred', 'Until you tap the eye']] });
  app('twostep', 'lock-keys', 2, { cam: [[0, 'twostep.panel']], mail: { src: 'launch/enable.png', beat: 1, end: 5 }, calls: [[5, 'twostep-code.panel', 'Two-step sign-in', 'A code by email at every sign-in']] });
  app('lock-keys', 'users', 2, { calls: [[0, 'lock-keys.panel', 'Ctrl + Shift + L'], [3, 'locked.screen', 'Locks like Windows', 'and when the window is hidden']] });
  // 07 — Team
  title('07', 'Made for a team', 'Roles, invitations, a full record');
  app('users', 'audit', 2, { calls: [[1, 'invite.form', 'Invite people with a role', 'Admin · operator · viewer']] });
  app('audit', 'system', 2, { calls: [[1, 'audit.cards', 'Every sign-in and change, recorded'], [5, 'audit-filter.log', 'Filter in one click']] });
  // 08 — Help
  title('08', 'Help, built in', 'From the first wire to the first reading');
  app('system', 'guide', 2, { calls: [[1, 'system.diagram', 'The whole system — live status']] });
  app('guide', 'support', 1, { cap: { at: 0, text: 'A step-by-step user guide' } });
  app('support', 'connect', 1, { calls: [[1, 'support-typed.form', 'Report a problem straight to IT']] });
  app('connect', 'settings', 2, { calls: [[0, 'connect.steps', 'Connect the ESP32 in 6 steps', 'From parts list to first reading', 2], [5, 'connect-code.code', 'The Arduino code is written for you', 'Your Wi-Fi and device key filled in']] });
  app('settings', 'dark', 2, { calls: [[1, 'settings.form', 'Limits · fixed schedule · parts · price']] });
  // 09 — Looks
  title('09', 'Any language. Any screen.', 'English · العربية · Bahasa Melayu');
  app('dark', 'arabic', 1, { cap: { at: 0, text: 'Dark mode' } });
  app('arabic', 'malay', 1, { cap: { at: 0, text: 'العربية — right to left' } });
  app('malay', 'END', 1, { cap: { at: 0, text: 'Bahasa Melayu' } });
  if (phone) add('phone', 2, { src: [phone.start, phone.end] });
  // 10 — Why this tech
  title('10', 'Why this technology', 'Every part chosen for a reason');
  add('tech', TECH.length, { items: TECH });
  // The ending (the cinematic reveal), its hit on the first beat.
  chapter = null;
  add('scene', 5, { from: 71.0, to: 81.0 });

  // For the score: where each kind of moment falls, in seconds of the film.
  const sec = fr => fr / FPS;
  const clicks = [];
  for (const s of shots.filter(s => s.type === 'app')) {
    const [a, b] = s.src;
    for (const e of TL.events) if (e.type === 'click' && e.seg === 'desktop' && e.t >= a && e.t < b && e.x) clicks.push(sec(s.f0 + (e.t - a) / (b - a) * s.len));
  }
  const cues = {
    total: sec(f), introEnd: sec(INTRO),
    shots: shots.map(s => ({ type: s.type, t0: sec(s.f0), t1: sec(s.f0 + s.len) })),
    mails: shots.filter(s => s.mail).map(s => sec(s.f0 + s.mail.beat * BEAT)),
    clicks,
  };
  return { shots, frames: f, cues, desk, phone, TL };
}

export const TECH = [
  { name: 'ESP32', tag: 'The device', why: 'Wi-Fi built in, low cost and low power. It sends each reading over HTTPS with its own device key.' },
  { name: 'DHT11 + CCS811', tag: 'The sensors', why: 'Temperature and humidity, plus eCO₂ and TVOC — the air-quality gases that rise as food spoils.' },
  { name: 'React + TypeScript', tag: 'The app', why: 'One fast, installable app for desktop and phone — in three languages, light and dark.' },
  { name: 'Node.js', tag: 'The server', why: 'The same code runs on a laptop and in the cloud, so it was tested before it went online.' },
  { name: 'Vercel', tag: 'The hosting', why: 'HTTPS everywhere, a deploy on every GitHub push, and no server to look after — inside the free plan.' },
  { name: 'Supabase PostgreSQL', tag: 'The database', why: 'A real SQL database: every reading kept, 7-day averages in one query, shared by every server copy.' },
  { name: 'Telegram + ntfy', tag: 'The alerts', why: 'Instant push alerts on any phone — free, and no app to build.' },
  { name: 'Email codes', tag: 'The accounts', why: 'New accounts confirmed by email, two-step sign-in, and a note when a new device signs in.' },
  { name: 'Security', tag: 'The trust', why: 'Hashed passwords, an encrypted vault, device keys, a security log and a strict content policy.' },
];
