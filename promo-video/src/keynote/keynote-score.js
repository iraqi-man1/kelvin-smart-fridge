// Original score for the keynote film (Web Audio, synthesised — no samples or licensed music).
// Calm and warm at 90 BPM: piano, pads, a soft pulse under the app shots, swells under the
// headline cards. Built from the edit's cues, so the music changes exactly on each cut.
window.buildKeynoteScore = function (ac, start, cues, sink) {
  const T = s => start + s, BEAT = 60 / 90, BAR = BEAT * 4;
  const master = ac.createGain(); master.gain.value = 0.95;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
  master.connect(comp); comp.connect(sink);
  master.gain.setValueAtTime(0.0001, T(cues.introEnd - 0.05)); master.gain.exponentialRampToValueAtTime(0.95, T(cues.introEnd + 0.6));
  master.gain.setValueAtTime(0.95, T(cues.total - 2.5)); master.gain.exponentialRampToValueAtTime(0.0001, T(cues.total - 0.02));
  const verb = ac.createConvolver(); const L = Math.floor(ac.sampleRate * 3.2), ir = ac.createBuffer(2, L, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let s = 11 + ch; for (let i = 0; i < L; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647 * 2 - 1) * Math.pow(1 - i / L, 2.6); } }
  verb.buffer = ir; const send = ac.createGain(); send.gain.value = 0.42; send.connect(verb); verb.connect(master);
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); { const d = nb.getChannelData(0); let s = 5; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 2147483647 * 2 - 1; } }
  const noise = (t, dur) => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.start(t, 0.2); s.stop(t + dur + 0.05); return s; };
  const osc = (type, f, t, d) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(t + d); return o; };

  // A soft electric-piano note: a few sine partials, quick attack, long decay.
  function piano(t, n, level, len = 2.4) {
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.008); g.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(1400, t + 1);
    f.connect(g); g.connect(master); g.connect(send);
    for (const [m, l] of [[1, 1], [2, 0.32], [3, 0.12], [4.01, 0.06]]) { const o = osc('sine', hz(n) * m, t, len + 0.1); const og = ac.createGain(); og.gain.value = l * 0.6; o.connect(og); og.connect(f); }
  }
  function pad(t, dur, notes, level, cutoff = 1300) {
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + 0.8); g.gain.setValueAtTime(level, t + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
    f.connect(g); g.connect(master); g.connect(send);
    for (const n of notes) for (const dt of [-6, 6]) { const o = osc('sawtooth', hz(n), t, dur + 1.4); o.detune.value = dt; const og = ac.createGain(); og.gain.value = 0.022; o.connect(og); og.connect(f); }
  }
  function bass(t, n, dur, level) { const o = osc('sine', hz(n), t, dur + 0.2), o2 = osc('triangle', hz(n), t, dur + 0.2); const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); const g2 = ac.createGain(); g2.gain.value = 0.2; o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); }
  function kick(t, level) { const o = ac.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4); }
  function shaker(t, level) { const s = noise(t, 0.08); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 7000; f.Q.value = 0.8; const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); s.connect(f); f.connect(g); g.connect(master); }
  function snap(t, level) { const s = noise(t, 0.12); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 1.2; const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); s.connect(f); f.connect(g); g.connect(master); g.connect(send); }
  function swell(t, dur, level) { const s = noise(t, dur); const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3500, t + dur); const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + dur * 0.92); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25); s.connect(f); f.connect(g); g.connect(master); g.connect(send); }
  function chime(t, notes, level) { notes.forEach((n, i) => { const o = osc('sine', hz(n), t + i * 0.09, 2), o2 = osc('sine', hz(n) * 3.01, t + i * 0.09, 1); const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t + i * 0.09); g.gain.exponentialRampToValueAtTime(level, t + i * 0.09 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 1.6); const g2 = ac.createGain(); g2.gain.value = 0.12; o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); g.connect(send); }); }
  function tick(t, level) { const o = osc('sine', 1800, t, 0.04); const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035); o.connect(g); g.connect(master); }
  function boom(t, level) { const o = ac.createOscillator(); o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.4); const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2); o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.1); }

  // Cmaj9 – Am9 – Fmaj9 – G6sus: warm and open.
  const PROG = [{ root: 36, pad: [55, 59, 62, 64], arp: [60, 64, 67, 71, 74] }, { root: 33, pad: [55, 60, 64, 67], arp: [57, 60, 64, 67, 71] }, { root: 29, pad: [57, 60, 64, 67], arp: [53, 57, 60, 64, 67] }, { root: 31, pad: [55, 60, 62, 64], arp: [55, 60, 62, 67, 69] }];
  let bar = 0;
  function musicBar(t0, mode) {
    const c = PROG[bar++ % 4];
    pad(T(t0), BAR, c.pad, mode === 'card' ? 0.2 : 0.15, mode === 'tech' ? 2000 : 1300);
    bass(T(t0), c.root, BAR * 0.9, mode === 'card' ? 0.16 : 0.22);
    // Piano: a gentle broken chord, eighth notes, softer off the beat.
    const pat = mode === 'card' ? [0, 2, 4] : [0, 2, 3, 4, 1, 3, 2, 4];
    pat.forEach((ix, i) => piano(T(t0 + i * (mode === 'card' ? BEAT * 1.33 : BEAT / 2)), c.arp[ix], i % 2 ? 0.05 : 0.075));
    if (mode === 'app' || mode === 'tech') for (let b = 0; b < 4; b++) { const tb = t0 + b * BEAT; if (b % 2 === 0) kick(T(tb), 0.3); if (b % 2 === 1) snap(T(tb), 0.05); shaker(T(tb + BEAT / 2), 0.05); shaker(T(tb + BEAT * 0.25), 0.02); shaker(T(tb + BEAT * 0.75), 0.025); }
  }
  cues.shots.forEach((s, i) => {
    const bars = Math.round((s.t1 - s.t0) / BAR), next = cues.shots[i + 1], last = i === cues.shots.length - 1;
    if (last) { boom(T(s.t0), 0.7); pad(T(s.t0), BAR * bars - 2, [48, 55, 59, 62, 64], 0.28, 2200); chime(T(s.t0 + 0.2), [84, 88, 91, 95], 0.05); piano(T(s.t0), 36, 0.12, 6); piano(T(s.t0), 48, 0.1, 6); return; }
    const mode = s.type === 'card' ? 'card' : s.type === 'tech' ? 'tech' : 'app';
    for (let b = 0; b < bars; b++) musicBar(s.t0 + b * BAR, mode);
    if (s.type === 'card') chime(T(s.t0 + 0.05), [79, 84], 0.035);
    if (s.type === 'telegram') chime(T(s.t0 + 24 / 30), [88, 95], 0.09), chime(T(s.t0 + 100 / 30), [91, 96], 0.07);
    if (next && next.type === 'card') swell(T(s.t1 - BAR * 0.75), BAR * 0.75, 0.05);
    if (next && i === cues.shots.length - 2) swell(T(s.t1 - BAR), BAR, 0.1);
  });
  for (const t of cues.mails) chime(T(t), [86, 91], 0.06);
  for (const t of cues.clicks) tick(T(t), 0.05);
};
