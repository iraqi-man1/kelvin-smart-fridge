import { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, Audio, Img, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import RAW from '../../public/rec/timeline.json';
import { BAR, FPS, TECH, buildEdit, normTL } from './edit.mjs';
import { drawFrame, setup } from '../scene.js';

const TL = normTL(RAW);
export const EDIT = buildEdit(TL);
const W = 1920, H = 1080;
const SANS = '"Inter", "IBM Plex Sans", "Segoe UI", sans-serif';
const INK = '#1d1d1f', GRAY = '#6e6e73', BG = '#f5f5f7';
const GRAD = 'linear-gradient(90deg, #2563eb, #06b6d4)';
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k); return k * k * (3 - 2 * k); };
const ease = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const lerp = (a, b, k) => a + (b - a) * k;
const fade = (lf, len, inF = 14, outF = 12) => Math.min(smooth(lf / inF), smooth((len - lf) / outF));

// ---------- footage ----------
function frameAt(seg, t) { const f = seg.frames; let lo = 0, hi = f.length - 1, best = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1; } return f[best].file; }
const curs = TL.events.filter(e => e.type === 'cursor' && e.seg === 'desktop');
function cursorAt(t) { if (!curs.length || t < curs[0].t) return null; let lo = 0, hi = curs.length - 1, b = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (curs[m].t <= t) { b = m; lo = m + 1; } else hi = m - 1; } const a = curs[b], n = curs[b + 1]; if (!n || n.t - a.t > 250) return [a.x, a.y]; const k = (t - a.t) / (n.t - a.t); return [lerp(a.x, n.x, k), lerp(a.y, n.y, k)]; }
function fit(r, [SW, SH] = [W, H]) {
  let [x, y, w, h] = r; const pad = 150; x -= pad; y -= pad; w += pad * 2; h += pad * 2;
  const cx = x + w / 2, cy = y + h / 2; w = Math.max(w, h * 16 / 9, 1150); h = w * 9 / 16;
  if (w > SW) { w = SW; h = w * 9 / 16; } if (h > SH) { h = SH; w = h * 16 / 9; }
  return [clamp(cx - w / 2, 0, SW - w), clamp(cy - h / 2, 0, SH - h), w, h];
}
const viewLerp = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
const push = (v, k) => { const s = 1 - 0.035 * k, cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2; return [cx - v[2] * s / 2, cy - v[3] * s / 2, v[2] * s, v[3] * s]; };

// A focus: the camera eases toward a part of the screen, the rest softly blurs, a note appears.
function Focused({ src, size, cam, focus, w }) {
  const [SW, SH] = size, s = W / cam[2];
  const img = extra => <Img src={src} style={{ position: 'absolute', left: -cam[0] * s, top: -cam[1] * s, width: SW * s, height: SH * s, ...extra }} />;
  if (!focus || w <= 0.001) return img({});
  const [x, y, rw, rh] = [(focus.rect[0] - cam[0]) * s, (focus.rect[1] - cam[1]) * s, focus.rect[2] * s, focus.rect[3] * s];
  const r = 18;
  return <>
    {img({ filter: `blur(${7 * w}px) saturate(${1 - 0.3 * w})` })}
    <div style={{ position: 'absolute', inset: 0, background: `rgba(245,245,247,${0.42 * w})` }} />
    <div style={{ position: 'absolute', left: x, top: y, width: rw, height: rh, borderRadius: r, boxShadow: `0 30px 90px rgba(0,0,0,${0.22 * w})` }} />
    {img({ clipPath: `inset(${y}px ${W - x - rw}px ${H - y - rh}px ${x}px round ${r}px)` })}
  </>;
}
function Note({ focus, cam, size, w }) {
  if (!focus || w <= 0.02) return null;
  const s = W / cam[2], x = (focus.rect[0] - cam[0]) * s, y = (focus.rect[1] - cam[1]) * s, rw = focus.rect[2] * s, rh = focus.rect[3] * s;
  const below = y + rh + 160 < H - 120, left = clamp(x, 60, W - 760), top = below ? y + rh + 26 : Math.max(40, y - 26 - 118);
  return <div style={{ position: 'absolute', left, top: top + (1 - w) * 14, opacity: w, maxWidth: 760, padding: '20px 28px', borderRadius: 22, background: 'rgba(255,255,255,.86)', backdropFilter: 'blur(24px)', boxShadow: '0 20px 60px rgba(0,0,0,.14)' }}>
    <div style={{ font: `600 36px ${SANS}`, color: INK, letterSpacing: -0.6 }}>{focus.text}</div>
    {focus.sub && <div style={{ font: `400 24px ${SANS}`, color: GRAY, marginTop: 6 }}>{focus.sub}</div>}
  </div>;
}
function Caption({ text, lf, len, dim = 0 }) {
  if (!text) return null; const k = fade(lf - 8, len - 8, 14, 12) * (1 - dim * 0.85); if (k <= 0.01) return null;
  return <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, display: 'flex', justifyContent: 'center', opacity: k, transform: `translateY(${(1 - k) * 10}px)` }}>
    <div style={{ padding: '18px 34px', borderRadius: 999, background: 'rgba(255,255,255,.84)', backdropFilter: 'blur(26px)', boxShadow: '0 16px 50px rgba(0,0,0,.14)', font: `600 36px ${SANS}`, color: INK, letterSpacing: -0.5 }}>{text}</div>
  </div>;
}
function Cursor({ x, y, s }) { return <svg style={{ position: 'absolute', left: x, top: y, overflow: 'visible', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.3))' }} width="30" height="34"><path d="M0 0 L0 26 L6.5 20 L11 30 L15 28.4 L10.6 18.6 L19 18.6 Z" fill="#fff" stroke="#111827" strokeWidth="1.5" transform={`scale(${s})`} /></svg>; }
function Mail({ src, k }) {
  if (k <= 0.01) return null;
  return <div style={{ position: 'absolute', right: 60, top: 54, width: 520, opacity: k, transform: `translateY(${(1 - k) * -40}px)`, padding: 14, borderRadius: 28, background: 'rgba(255,255,255,.78)', backdropFilter: 'blur(30px)', boxShadow: '0 30px 80px rgba(0,0,0,.18)' }}>
    <div style={{ font: `600 18px ${SANS}`, color: GRAY, margin: '2px 6px 10px' }}>✉ Mail · now</div>
    <Img src={staticFile(src)} style={{ width: '100%', display: 'block', borderRadius: 16 }} />
  </div>;
}

function AppShot({ shot, lf, prev }) {
  const [a, b] = shot.src, t = a + (lf / shot.len) * (b - a);
  let best = null, w = 0;
  for (const f of shot.focus) { const k = smooth(Math.min((t - f.at) / 600, (f.at + f.dur - t) / 600)); if (t >= f.at && t <= f.at + f.dur && k > w) { w = k; best = f; } }
  const full = push([0, 0, W, H], lf / shot.len);
  const cam = best ? viewLerp(full, fit(best.rect), ease(w)) : full;
  const s = W / cam[2], cur = cursorAt(t);
  const mk = shot.mail ? smooth(Math.min((t - shot.mail.at) / 450, (shot.mail.until - t) / 450)) : 0;
  return <AbsoluteFill style={{ background: BG }}>
    <Focused src={staticFile('rec/frames/' + frameAt(EDIT.desk, t))} size={[W, H]} cam={cam} focus={best} w={w} />
    {cur && <Cursor x={(cur[0] - cam[0]) * s} y={(cur[1] - cam[1]) * s} s={Math.min(1.7, 1.05 * s)} />}
    <Note focus={best} cam={cam} size={[W, H]} w={w} />
    {shot.mail && <Mail src={shot.mail.src ?? (shot.mail.mark === 'confirm' ? 'launch/signup.png' : 'launch/enable.png')} k={mk} />}
    <Caption text={shot.cap} lf={lf} len={shot.len} dim={w} />
    {prev && prev.type !== 'app' && <div style={{ position: 'absolute', inset: 0, background: BG, opacity: 1 - smooth(lf / 14) }} />}
  </AbsoluteFill>;
}
function ImageShot({ shot, lf }) {
  const [SW, SH] = shot.size, p = ease(lf / shot.len);
  const view = shot.pan ? viewLerp(shot.pan[0], shot.pan[1], p) : [0, 0, W, H];
  let best = null, w = 0;
  for (const [f0, fd, rect, text, sub] of shot.focus) { const a = f0 * shot.len, b = (f0 + fd) * shot.len, k = smooth(Math.min((lf - a) / 18, (b - lf) / 18)); if (lf >= a && lf <= b && k > w) { w = k; best = { rect, text, sub }; } }
  const cam = best ? viewLerp(view, fit(best.rect, shot.size), ease(w)) : view;
  return <AbsoluteFill style={{ background: '#fff' }}>
    <Focused src={staticFile(shot.src)} size={[SW, SH]} cam={cam} focus={best} w={w} />
    <Note focus={best} cam={cam} size={[SW, SH]} w={w} />
    <Caption text={shot.cap} lf={lf} len={shot.len} dim={w} />
  </AbsoluteFill>;
}
function CardShot({ shot, lf, prev }) {
  const k1 = smooth((lf - 2) / 16), k2 = smooth((lf - 9) / 18), k3 = smooth((lf - 16) / 18), out = smooth((shot.len - lf) / 12);
  return <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ textAlign: 'center', opacity: out }}>
      <div style={{ font: `600 30px ${SANS}`, color: GRAY, letterSpacing: 0.5, opacity: k1, transform: `translateY(${(1 - k1) * 12}px)` }}>{shot.eyebrow}</div>
      <div style={{ font: `700 128px ${SANS}`, color: INK, letterSpacing: -4, lineHeight: 1.05, marginTop: 18, opacity: k2, transform: `translateY(${(1 - k2) * 26}px)` }}>{shot.line1}</div>
      <div style={{ font: `700 128px ${SANS}`, letterSpacing: -4, lineHeight: 1.08, opacity: k3, transform: `translateY(${(1 - k3) * 26}px)`, background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingBottom: 10 }}>{shot.line2}</div>
    </div>
    {prev && prev.type === 'scene' && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: 1 - smooth(lf / 16) }} />}
  </AbsoluteFill>;
}
const NOTE1 = ['⚠️ Temperature rose above the limit', 'Reading: 8.1 °C', 'Limit: 8 °C', 'Device: ESP32-WROOM-32', 'Time: 7:21 PM'];
const NOTE2 = ['✅ Temperature is back to normal: 7.8 °C'];
function Phone({ children, k }) {
  const ph = 900, pw = 420;
  return <div style={{ position: 'absolute', left: 1180, top: (H - ph) / 2 - 14 + (1 - k) * 50, width: pw + 28, height: ph + 28, borderRadius: 70, background: '#111', boxShadow: '0 50px 100px rgba(15,23,42,.28)', opacity: k }}>
    <div style={{ position: 'absolute', left: 14, top: 14, width: pw, height: ph, borderRadius: 58, overflow: 'hidden', background: '#fff' }}>{children}</div>
    <div style={{ position: 'absolute', left: (pw + 28) / 2 - 58, top: 26, width: 116, height: 30, borderRadius: 15, background: '#111' }} />
  </div>;
}
function Notif({ lines, k, top }) {
  if (k <= 0.01) return null;
  return <div style={{ position: 'absolute', left: 18, right: 18, top: top + (1 - k) * -40, opacity: k, padding: '18px 20px', borderRadius: 26, background: 'rgba(255,255,255,.72)', backdropFilter: 'blur(26px)', boxShadow: '0 12px 30px rgba(0,0,0,.18)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: `600 16px ${SANS}`, color: '#3a3a3c' }}><span style={{ width: 28, height: 28, borderRadius: 8, background: '#2aa3e0', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>➤</span>TELEGRAM<span style={{ marginLeft: 'auto', fontWeight: 400 }}>now</span></div>
    {lines.map((l, i) => <div key={i} style={{ font: `${i ? 400 : 600} ${i ? 19 : 20}px ${SANS}, "Segoe UI Emoji"`, color: INK, marginTop: i ? 2 : 10 }}>{l}</div>)}
  </div>;
}
function TelegramShot({ shot, lf }) {
  const k = smooth(lf / 18), n1 = smooth((lf - 24) / 12), n2 = smooth((lf - 100) / 12), out = smooth((shot.len - lf) / 12);
  return <AbsoluteFill style={{ background: `linear-gradient(135deg, ${BG}, #e6ebf3)`, opacity: out }}>
    <div style={{ position: 'absolute', left: 170, top: 380, opacity: k }}>
      <div style={{ font: `700 92px ${SANS}`, color: INK, letterSpacing: -3, lineHeight: 1.05 }}>Delivered to Telegram,</div>
      <div style={{ font: `700 92px ${SANS}`, letterSpacing: -3, lineHeight: 1.1, background: GRAD, WebkitBackgroundClip: 'text', color: 'transparent' }}>instantly.</div>
      <div style={{ font: `400 34px ${SANS}`, color: GRAY, marginTop: 20 }}>And to ntfy — the moment a limit is crossed.</div>
    </div>
    <Phone k={k}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,#1e3a8a,#0e7490 55%,#0f172a)' }} />
      <div style={{ position: 'absolute', top: 110, width: '100%', textAlign: 'center', font: `300 110px ${SANS}`, color: '#fff' }}>7:21</div>
      <div style={{ position: 'absolute', top: 240, width: '100%', textAlign: 'center', font: `500 24px ${SANS}`, color: 'rgba(255,255,255,.85)' }}>Thursday, 27 November</div>
      <Notif lines={NOTE1} k={n1} top={320} />
      <Notif lines={NOTE2} k={n2} top={560} />
    </Phone>
  </AbsoluteFill>;
}
function PhoneShot({ shot, lf }) {
  const [a, b] = shot.src, t = a + (lf / shot.len) * (b - a), k = smooth(lf / 18);
  return <AbsoluteFill style={{ background: `linear-gradient(135deg, ${BG}, #e6ebf3)` }}>
    <div style={{ position: 'absolute', left: 170, top: 400, opacity: k }}>
      <div style={{ font: `700 92px ${SANS}`, color: INK, letterSpacing: -3 }}>On your phone.</div>
      <div style={{ font: `400 36px ${SANS}`, color: GRAY, marginTop: 18 }}>It installs like an app. Same account, same live data.</div>
    </div>
    <Phone k={k}><Img src={staticFile('rec/frames/' + frameAt(EDIT.phone, t))} style={{ width: '100%', display: 'block', marginTop: 40 }} /></Phone>
  </AbsoluteFill>;
}
function TechShot({ shot, lf, next }) {
  const k = smooth((lf - 2) / 16), k2 = smooth((lf - 10) / 18), out = smooth((shot.len - lf) / 12);
  return <AbsoluteFill style={{ background: '#fff' }}>
    <div style={{ position: 'absolute', left: 200, top: 330, width: 1300, opacity: out }}>
      <div style={{ font: `600 30px ${SANS}`, color: GRAY, opacity: k }}>{String(shot.index + 1).padStart(2, '0')} / {String(TECH.length).padStart(2, '0')}</div>
      <div style={{ font: `700 104px ${SANS}`, color: INK, letterSpacing: -3.5, lineHeight: 1.05, marginTop: 16, opacity: k, transform: `translateY(${(1 - k) * 22}px)` }}>{shot.item.name}</div>
      <div style={{ font: `400 42px ${SANS}`, color: GRAY, lineHeight: 1.4, marginTop: 28, opacity: k2, transform: `translateY(${(1 - k2) * 16}px)` }}>{shot.item.why}</div>
    </div>
    <div style={{ position: 'absolute', left: 200, bottom: 120, display: 'flex', gap: 12 }}>
      {TECH.map((_, i) => <div key={i} style={{ width: i === shot.index ? 44 : 12, height: 12, borderRadius: 6, background: i === shot.index ? INK : '#d2d2d7' }} />)}
    </div>
    {next && next.type === 'scene' && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: smooth((lf - (shot.len - 16)) / 16) }} />}
  </AbsoluteFill>;
}
function SceneShot({ shot, lf }) {
  const ref = useRef(null);
  const [handle] = useState(() => delayRender('scene assets'));
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => { setup(staticFile).then(() => { setReady(true); continueRender(handle); }); }, [handle]);
  useLayoutEffect(() => { if (!ready) return; const T = shot.from + (lf / shot.len) * (shot.to - shot.from); const src = drawFrame(Math.min(T, 79.99)); const cv = ref.current; cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0); }, [lf, ready, shot]);
  return <AbsoluteFill style={{ background: '#000' }}><canvas ref={ref} width={W} height={H} style={{ width: W, height: H }} /></AbsoluteFill>;
}

export const Keynote = () => {
  const frame = useCurrentFrame();
  const intro = { type: 'scene', f0: 0, len: EDIT.shots[0].f0, from: 0, to: 11 };
  const all = [intro, ...EDIT.shots];
  const i = Math.max(0, all.findIndex(s => frame >= s.f0 && frame < s.f0 + s.len)), shot = all[i === -1 ? all.length - 1 : i];
  const lf = frame - shot.f0, prev = all[i - 1], next = all[i + 1];
  return <AbsoluteFill style={{ backgroundColor: '#000' }}>
    {shot.type === 'scene' && <SceneShot shot={shot} lf={lf} />}
    {shot.type === 'card' && <CardShot shot={shot} lf={lf} prev={prev} />}
    {shot.type === 'app' && <AppShot shot={shot} lf={lf} prev={prev} />}
    {shot.type === 'image' && <ImageShot shot={shot} lf={lf} />}
    {shot.type === 'telegram' && <TelegramShot shot={shot} lf={lf} />}
    {shot.type === 'phone' && <PhoneShot shot={shot} lf={lf} />}
    {shot.type === 'tech' && <TechShot shot={shot} lf={lf} next={next} />}
    {['app', 'image', 'phone', 'telegram'].includes(shot.type) && <div style={{ position: 'absolute', right: 34, bottom: 22, font: `500 16px ${SANS}`, color: 'rgba(110,110,115,.75)' }}>Real app · sample data</div>}
    <Audio src={staticFile('keynote.wav')} />
  </AbsoluteFill>;
};
