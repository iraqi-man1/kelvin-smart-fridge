import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AbsoluteFill, Audio, Img, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import TL from '../../public/rec/timeline.json';
import { BEAT, FPS, buildEdit } from './edit.mjs';
import { drawFrame, setup } from '../scene.js';

export const EDIT = buildEdit(TL);
const W = 1920, H = 1080;
const SANS = '"IBM Plex Sans", "Segoe UI", sans-serif', MONO = '"IBM Plex Mono", Consolas, monospace';
const ACC = '#22d3ee', ACC2 = '#38bdf8';
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const out = k => { k = clamp(k); return 1 - Math.pow(1 - k, 4); };
const back = k => { k = clamp(k); const c = 1.6; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const lerp = (a, b, k) => a + (b - a) * k;

// ---------- Footage helpers ----------
function frameAt(seg, t) { const f = seg.frames; let lo = 0, hi = f.length - 1, best = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1; } return f[best].file; }
const cursors = { desktop: TL.events.filter(e => e.type === 'cursor' && e.seg === 'desktop'), phone: TL.events.filter(e => e.type === 'cursor' && e.seg === 'phone') };
const clicks = { desktop: TL.events.filter(e => e.type === 'click' && e.seg === 'desktop' && e.x), phone: TL.events.filter(e => e.type === 'click' && e.seg === 'phone') };
function cursorAt(seg, t) { const cs = cursors[seg]; if (!cs.length || t < cs[0].t) return null; let lo = 0, hi = cs.length - 1, b = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].t <= t) { b = m; lo = m + 1; } else hi = m - 1; } const a = cs[b], n = cs[b + 1]; if (!n || n.t - a.t > 250) return [a.x, a.y]; const k = (t - a.t) / (n.t - a.t); return [lerp(a.x, n.x, k), lerp(a.y, n.y, k)]; }

// A view rectangle with the screen's 16:9 shape, around a target.
function fit(r, size = [W, H]) {
  const [SW, SH] = size; if (!r) return [0, 0, Math.min(SW, SH * 16 / 9), Math.min(SH, SW * 9 / 16)];
  let [x, y, w, h] = r; const pad = 70; x -= pad; y -= pad; w += pad * 2; h += pad * 2;
  const cx = x + w / 2, cy = y + h / 2; w = Math.max(w, h * 16 / 9, 760); h = w * 9 / 16;
  if (w > SW) { w = SW; h = w * 9 / 16; } if (h > SH) { h = SH; w = h * 16 / 9; }
  return [clamp(cx - w / 2, 0, SW - w), clamp(cy - h / 2, 0, SH - h), w, h];
}
// Camera for a shot at local frame lf: a quick, eased move at each key's beat, then a slow drift.
function camera(shot, lf) {
  const keys = shot.cam.map(k => ({ at: k.beat * BEAT, v: k.rect && k.rect.length === 4 && shot.type === 'image' ? fit(k.rect, shot.size) : fit(k.rect, shot.size) }));
  let i = 0; for (let j = 0; j < keys.length; j++) if (keys[j].at <= lf) i = j;
  const cur = keys[i], prev = keys[i - 1] ?? cur, k = ease((lf - cur.at) / 13);
  let v = prev.v.map((p, n) => lerp(p, cur.v[n], i === 0 ? 1 : k));
  const drift = 1 - 0.035 * (lf / shot.len); // slow push in
  const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2; v = [cx - v[2] * drift / 2, cy - v[3] * drift / 2, v[2] * drift, v[3] * drift];
  return v;
}

// ---------- Overlays ----------
function Spotlight({ r, lf, start, end, text, sub }) {
  const k = out((lf - start) / 8) * (1 - out((lf - (end - 6)) / 6));
  if (k <= 0) return null;
  const [x, y, w, h] = r, dim = `rgba(2,6,18,${0.55 * k})`;
  const below = y + h + 150 < H, lx = clamp(x, 40, W - 640), ly = below ? y + h + 22 : y - 22 - 112;
  return <>
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: Math.max(0, y), background: dim }} />
    <div style={{ position: 'absolute', left: 0, top: y + h, width: W, height: Math.max(0, H - y - h), background: dim }} />
    <div style={{ position: 'absolute', left: 0, top: y, width: Math.max(0, x), height: h, background: dim }} />
    <div style={{ position: 'absolute', left: x + w, top: y, width: Math.max(0, W - x - w), height: h, background: dim }} />
    <div style={{ position: 'absolute', left: x - 6, top: y - 6, width: w + 12, height: h + 12, borderRadius: 16, border: `3px solid ${ACC}`, boxShadow: `0 0 0 6px rgba(34,211,238,.18), 0 0 40px rgba(34,211,238,.55)`, opacity: k, transform: `scale(${lerp(1.06, 1, out((lf - start) / 9))})` }} />
    <div style={{ position: 'absolute', left: lx, top: ly + (1 - k) * (below ? -14 : 14), opacity: k, maxWidth: 640, padding: '18px 24px', borderRadius: 18, background: 'rgba(8,13,28,.94)', boxShadow: '0 20px 50px rgba(0,0,0,.45)', borderLeft: `5px solid ${ACC}` }}>
      <div style={{ font: `600 34px ${SANS}`, color: '#fff', letterSpacing: -0.3 }}>{text}</div>
      {sub && <div style={{ font: `400 22px ${SANS}`, color: '#a5b4c8', marginTop: 6 }}>{sub}</div>}
    </div>
  </>;
}
function Cursor({ x, y, s = 1 }) {
  return <svg style={{ position: 'absolute', left: x, top: y, overflow: 'visible', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.35))' }} width="30" height="34">
    <path d="M0 0 L0 26 L6.5 20 L11 30 L15 28.4 L10.6 18.6 L19 18.6 Z" fill="#fff" stroke="#111827" strokeWidth="1.6" transform={`scale(${1.2 * s})`} />
  </svg>;
}
function ChapterTag({ chapter, lf }) {
  if (!chapter) return null;
  return <div style={{ position: 'absolute', left: 36, top: 28, display: 'flex', gap: 12, alignItems: 'center', padding: '9px 18px', borderRadius: 999, background: 'rgba(8,13,28,.82)', boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>
    <span style={{ font: `600 18px ${MONO}`, color: ACC }}>{chapter.num}</span>
    <span style={{ font: `600 18px ${SANS}`, color: '#e2e8f0', letterSpacing: 2, textTransform: 'uppercase' }}>{chapter.text}</span>
  </div>;
}
function Caption({ cap, lf }) {
  if (!cap) return null; const st = cap.at * BEAT, k = out((lf - st) / 9); if (k <= 0) return null;
  return <div style={{ position: 'absolute', left: 60, bottom: 56, padding: '16px 26px', borderRadius: 16, background: 'rgba(8,13,28,.9)', borderLeft: `5px solid ${ACC}`, opacity: k, transform: `translateY(${(1 - k) * 20}px)`, font: `600 36px ${SANS}`, color: '#fff' }}>{cap.text}</div>;
}
function Badge() { return <div style={{ position: 'absolute', right: 36, bottom: 24, font: `500 17px ${MONO}`, color: 'rgba(100,116,139,.9)', letterSpacing: 1 }}>Real app · sample data</div>; }

// ---------- Shots ----------
function AppShot({ shot, lf }) {
  const [a, b] = shot.src, t = a + (lf / shot.len) * (b - a);
  const cam = camera(shot, lf), s = W / cam[2];
  const map = ([x, y, w, h]) => [(x - cam[0]) * s, (y - cam[1]) * s, w * s, h * s];
  const cur = cursorAt('desktop', t);
  const punch = 1 + 0.025 * (1 - out(lf / 8)); // a little punch on each cut
  const calls = shot.calls.map((c, i) => ({ ...c, start: c.beat * BEAT, end: c.end ? c.end * BEAT : (shot.calls[i + 1] ? shot.calls[i + 1].beat * BEAT : shot.len) }));
  return <AbsoluteFill style={{ background: '#f1f3f6', transform: `scale(${punch})` }}>
    <Img src={staticFile('rec/frames/' + frameAt(EDIT.desk, t))} style={{ position: 'absolute', left: -cam[0] * s, top: -cam[1] * s, width: W * s, height: H * s }} />
    {clicks.desktop.filter(e => t - e.t >= 0 && t - e.t < 550).map((e, i) => { const k = (t - e.t) / 550, [x, y] = map([e.x, e.y, 0, 0]); return <div key={i} style={{ position: 'absolute', left: x - 50, top: y - 50, width: 100, height: 100, borderRadius: '50%', border: `4px solid ${ACC2}`, opacity: 1 - k, transform: `scale(${0.25 + k})` }} />; })}
    {calls.map((c, i) => <Spotlight key={i} r={map(c.rect)} lf={lf} start={c.start} end={c.end} text={c.text} sub={c.sub} />)}
    {cur && (() => { const [x, y] = map([cur[0], cur[1], 0, 0]); return <Cursor x={x} y={y} s={Math.min(2, s)} />; })()}
    {shot.mail && <MailCard mail={shot.mail} lf={lf} />}
    <Caption cap={shot.cap} lf={lf} />
  </AbsoluteFill>;
}
function MailCard({ mail, lf }) {
  const st = mail.beat * BEAT, en = mail.end * BEAT, k = back((lf - st) / 12) * (1 - out((lf - en) / 8)); if (lf < st || k <= 0) return null;
  const left = mail.side === 'left';
  return <div style={{ position: 'absolute', ...(left ? { left: 70 } : { right: 70 }), top: 120, width: 560, transform: `translateX(${(1 - k) * (left ? -640 : 640)}px) rotate(${(1 - k) * (left ? -4 : 4)}deg)`, filter: 'drop-shadow(0 30px 60px rgba(2,6,23,.45))' }}>
    <div style={{ font: `600 18px ${MONO}`, color: ACC, letterSpacing: 2, margin: '0 0 10px 6px', textShadow: '0 1px 8px rgba(0,0,0,.4)' }}>✉ NEW EMAIL</div>
    <Img src={staticFile(mail.src)} style={{ width: 560, display: 'block' }} />
  </div>;
}
function ImageShot({ shot, lf }) {
  const cam = camera(shot, lf), s = W / cam[2], [SW, SH] = shot.size;
  const map = ([x, y, w, h]) => [(x - cam[0]) * s, (y - cam[1]) * s, w * s, h * s];
  const calls = shot.calls.map((c, i) => ({ ...c, start: c.beat * BEAT, end: shot.calls[i + 1] ? shot.calls[i + 1].beat * BEAT : shot.len }));
  return <AbsoluteFill style={{ background: '#fff' }}>
    <Img src={staticFile(shot.src)} style={{ position: 'absolute', left: -cam[0] * s, top: -cam[1] * s, width: SW * s, height: SH * s }} />
    {calls.map((c, i) => <Spotlight key={i} r={map(c.rect)} lf={lf} start={c.start} end={c.end} text={c.text} sub={c.sub} />)}
    <Caption cap={shot.cap} lf={lf} />
  </AbsoluteFill>;
}
function Particles({ lf, n = 70, color = '125,211,252' }) {
  return <>{Array.from({ length: n }, (_, i) => { const r = (i * 9301 + 49297) % 233280 / 233280, r2 = (i * 4561 + 1234) % 9973 / 9973; const x = (r * W + lf * (0.6 + r2) * 2) % W, y = (r2 * H - lf * 0.5 * r + H * 9) % H, z = 1 + 3 * r;
    return <div key={i} style={{ position: 'absolute', left: x, top: y, width: z, height: z, borderRadius: '50%', background: `rgba(${color},${0.2 + 0.5 * r2})`, boxShadow: `0 0 ${z * 4}px rgba(${color},.6)` }} />; })}</>;
}
function TitleCard({ shot, lf }) {
  const words = shot.text.split(' ');
  const wipe = out(lf / 10), exit = out((lf - (shot.len - 8)) / 8);
  return <AbsoluteFill style={{ background: 'radial-gradient(circle at 30% 30%, #0f2a52 0%, #050913 60%)', overflow: 'hidden' }}>
    <Particles lf={lf} />
    <div style={{ position: 'absolute', left: 0, top: 0, height: H, width: W * wipe, background: 'linear-gradient(90deg, rgba(34,211,238,.0), rgba(34,211,238,.18))', opacity: 1 - out((lf - 8) / 10) }} />
    <div style={{ position: 'absolute', left: 160, top: 330, transform: `translateX(${-exit * 120}px)`, opacity: 1 - exit }}>
      <div style={{ font: `600 30px ${MONO}`, color: ACC, letterSpacing: 6, opacity: out(lf / 6), transform: `translateY(${(1 - out(lf / 6)) * 20}px)` }}>{shot.num} ——</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 26px', marginTop: 18, maxWidth: 1500 }}>
        {words.map((w, i) => { const k = back((lf - 3 - i * 2.5) / 10); return <span key={i} style={{ font: `700 112px ${SANS}`, color: '#fff', letterSpacing: -2, display: 'inline-block', opacity: clamp(k), transform: `translateY(${(1 - k) * 60}px)` }}>{w}</span>; })}
      </div>
      <div style={{ font: `400 38px ${SANS}`, color: '#a5b4c8', marginTop: 22, opacity: out((lf - 14) / 10) }}>{shot.sub}</div>
    </div>
  </AbsoluteFill>;
}
function PhoneShot({ shot, lf }) {
  const [a, b] = shot.src, t = a + (lf / shot.len) * (b - a), k = out(lf / 14);
  const ph = 940, pw = ph * 975 / 2110;
  return <AbsoluteFill style={{ background: 'linear-gradient(135deg,#eef3fa,#dbe5f3)' }}>
    <div style={{ position: 'absolute', left: 160, top: 360, opacity: k, transform: `translateY(${(1 - k) * 30}px)` }}>
      <div style={{ font: `600 28px ${MONO}`, color: '#2563eb', letterSpacing: 4 }}>ON YOUR PHONE</div>
      <div style={{ font: `700 84px ${SANS}`, color: '#0b1220', marginTop: 12, letterSpacing: -1 }}>Install it like an app.</div>
      <div style={{ font: `400 36px ${SANS}`, color: '#475569', marginTop: 16 }}>Same account, same live data.</div>
    </div>
    <div style={{ position: 'absolute', left: 1180, top: (H - ph) / 2 - 16 + (1 - k) * 60, width: pw + 32, height: ph + 32, borderRadius: 64, background: '#0b1220', boxShadow: '0 40px 80px rgba(15,23,42,.35)', transform: `rotate(${(1 - k) * 6}deg)` }}>
      <div style={{ position: 'absolute', left: 16, top: 16, width: pw, height: ph, borderRadius: 50, overflow: 'hidden', background: '#fff' }}>
        <Img src={staticFile('rec/frames/' + frameAt(EDIT.phone, t))} style={{ width: pw, display: 'block' }} />
      </div>
      <div style={{ position: 'absolute', left: (pw + 32) / 2 - 56, top: 26, width: 112, height: 28, borderRadius: 14, background: '#0b1220' }} />
    </div>
  </AbsoluteFill>;
}
function TechShot({ shot, lf }) {
  const i = clamp(Math.floor(lf / 60), 0, shot.items.length - 1), li = lf - i * 60, item = shot.items[i];
  const k = back(li / 11), out1 = out((li - 52) / 8);
  return <AbsoluteFill style={{ background: 'radial-gradient(circle at 70% 40%, #0e2244 0%, #04070f 65%)', overflow: 'hidden' }}>
    <Particles lf={lf} n={50} />
    <div style={{ position: 'absolute', left: 150, top: 250, width: 1000, opacity: clamp(k) * (1 - out1), transform: `translateY(${(1 - clamp(k)) * 50 - out1 * 30}px)` }}>
      <div style={{ font: `600 26px ${MONO}`, color: ACC, letterSpacing: 6, textTransform: 'uppercase' }}>{String(i + 1).padStart(2, '0')} · {item.tag}</div>
      <div style={{ font: `700 104px ${SANS}`, color: '#fff', letterSpacing: -2, marginTop: 14, lineHeight: 1.05 }}>{item.name}</div>
      <div style={{ font: `400 40px ${SANS}`, color: '#cbd5e1', marginTop: 26, lineHeight: 1.35 }}>{item.why}</div>
    </div>
    <div style={{ position: 'absolute', left: 1300, top: 230, display: 'grid', gridTemplateColumns: 'repeat(3, 160px)', gap: 16 }}>
      {shot.items.map((it, j) => { const on = j <= i, act = j === i, pk = act ? back(li / 10) : 1;
        return <div key={j} style={{ height: 160, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 12, font: `600 19px ${SANS}`, color: on ? '#fff' : 'rgba(148,163,184,.35)', background: act ? 'linear-gradient(135deg,#0ea5e9,#2563eb)' : on ? 'rgba(30,58,95,.75)' : 'rgba(15,23,42,.6)', border: `1px solid ${act ? 'rgba(165,243,252,.8)' : 'rgba(56,189,248,.18)'}`, boxShadow: act ? '0 0 50px rgba(56,189,248,.55)' : 'none', transform: `scale(${act ? lerp(0.8, 1.06, clamp(pk)) : 1})` }}>{it.name}</div>; })}
    </div>
  </AbsoluteFill>;
}
function SceneShot({ shot, lf }) {
  const ref = useRef(null);
  const [handle] = useState(() => delayRender('scene assets'));
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => { setup(staticFile).then(() => { setReady(true); continueRender(handle); }); }, [handle]);
  useLayoutEffect(() => { if (!ready) return; const T = shot.from + (lf / shot.len) * (shot.to - shot.from); ref.current.getContext('2d').drawImage(drawFrame(Math.min(T, 79.99)), 0, 0); }, [lf, ready, shot]);
  return <AbsoluteFill style={{ background: '#000' }}><canvas ref={ref} width={W} height={H} /></AbsoluteFill>;
}

export const Launch = () => {
  const frame = useCurrentFrame();
  const shot = frame < EDIT.shots[0].f0 ? { type: 'scene', f0: 0, len: EDIT.shots[0].f0, from: 0, to: 11 } : EDIT.shots.find(s => frame >= s.f0 && frame < s.f0 + s.len) ?? EDIT.shots.at(-1);
  const lf = frame - shot.f0;
  return <AbsoluteFill style={{ backgroundColor: '#000' }}>
    {shot.type === 'scene' && <SceneShot shot={shot} lf={lf} />}
    {shot.type === 'app' && <AppShot shot={shot} lf={lf} />}
    {shot.type === 'image' && <ImageShot shot={shot} lf={lf} />}
    {shot.type === 'title' && <TitleCard shot={shot} lf={lf} />}
    {shot.type === 'phone' && <PhoneShot shot={shot} lf={lf} />}
    {shot.type === 'tech' && <TechShot shot={shot} lf={lf} />}
    {['app', 'image', 'phone'].includes(shot.type) && <><ChapterTag chapter={shot.chapter} lf={lf} /><Badge /></>}
    <Audio src={staticFile('launch.wav')} />
  </AbsoluteFill>;
};
