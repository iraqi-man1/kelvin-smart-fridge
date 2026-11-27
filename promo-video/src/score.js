// Original score and sound design for the Kelvin promo (Web Audio API, synthesised — no
// samples, no licensed or copyrighted music). 100 BPM; cues match the scene times in promo.html.
window.buildPromoScore = function (ac, start, total, sink = null) {
  const T = s => start + s;
  const master = ac.createGain(); master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.008; comp.release.value = 0.3;
  master.connect(comp);
  const dest = sink ? null : ac.createMediaStreamDestination(); comp.connect(sink || dest);
  master.gain.setValueAtTime(0.0001, T(0)); master.gain.exponentialRampToValueAtTime(0.9, T(1.5));
  master.gain.setValueAtTime(0.9, T(total - 2.5)); master.gain.exponentialRampToValueAtTime(0.0001, T(total - 0.05));

  // Music bus with a filter (for the tense part) and a reverb.
  const music = ac.createGain(); music.gain.value = 1; const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 18000; music.connect(mf); mf.connect(master);
  const verb = ac.createConvolver(); const L = Math.floor(ac.sampleRate * 3.4), ir = ac.createBuffer(2, L, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < L; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 3); }
  verb.buffer = ir; const send = ac.createGain(); send.gain.value = 0.38; send.connect(verb); verb.connect(master);
  const BEAT = 0.6, BAR = 2.4;
  const delay = ac.createDelay(2); delay.delayTime.value = BEAT * 0.75; const fb = ac.createGain(); fb.gain.value = 0.3; const dlf = ac.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2400;
  delay.connect(dlf); dlf.connect(fb); fb.connect(delay); dlf.connect(music); dlf.connect(send);

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const noise = (t, dur) => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.start(t, Math.random()); s.stop(t + dur + 0.05); return s; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };

  function pad(t, dur, notes, level, bus = music, cutoff = 1300) {
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + 1.0); g.gain.setValueAtTime(level, t + Math.max(1.0, dur - 0.3)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.6);
    f.connect(g); g.connect(bus); g.connect(send);
    for (const n of notes) for (const dt of [-8, 8]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = dt; const og = ac.createGain(); og.gain.value = 0.04; o.connect(og); og.connect(f); o.start(t); o.stop(t + dur + 1.8); }
  }
  function drone(t, dur, n, level) {
    for (const [m, l, type] of [[0, 1, 'sine'], [12, 0.25, 'triangle'], [7, 0.12, 'sine']]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = hz(n + m); const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level * l, t + 2.5); g.gain.setValueAtTime(level * l, t + dur - 1); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
      o.connect(g); g.connect(music); g.connect(send); o.start(t); o.stop(t + dur + 0.7);
    }
  }
  function pluck(t, n, level, bright = 3000) {
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(n);
    const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = hz(n + 12); const g2 = ac.createGain(); g2.gain.value = 0.3;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(bright, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.25);
    const g = ac.createGain(); env(g, t, 0.004, level, 0.3);
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(music); g.connect(delay);
    o.start(t); o2.start(t); o.stop(t + 0.4); o2.stop(t + 0.4);
  }
  function bass(t, n, dur, level) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n); const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = hz(n);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; const g2 = ac.createGain(); g2.gain.value = 0.18;
    const g = ac.createGain(); env(g, t, 0.015, level, dur);
    o.connect(g); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(music); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
  function kick(t, level) { const o = ac.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38); o.connect(g); g.connect(music); o.start(t); o.stop(t + 0.4); }
  function hat(t, level, open = false) { const s = noise(t, open ? 0.25 : 0.06); const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7800; const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.22 : 0.05)); s.connect(f); f.connect(g); g.connect(music); }
  function clap(t, level) { const s = noise(t, 0.25); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.7; const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); s.connect(f); f.connect(g); g.connect(music); g.connect(send); }
  function bell(t, n, level) { for (const [m, l] of [[1, 1], [2.76, 0.3], [5.4, 0.1]]) { const o = ac.createOscillator(); o.frequency.value = hz(n) * m; const g = ac.createGain(); env(g, t, 0.005, level * l, 2.6); o.connect(g); g.connect(music); g.connect(send); o.start(t); o.stop(t + 2.8); } }
  // ---- Sound effects (straight to the master, not filtered) ----
  function whoosh(t, level, dur = 0.7) { const s = noise(t, dur); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3600, t + dur * 0.6); f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); const p = ac.createStereoPanner(); p.pan.setValueAtTime(-0.6, t); p.pan.linearRampToValueAtTime(0.6, t + dur);
    s.connect(f); f.connect(g); g.connect(p); p.connect(master); p.connect(send); }
  function riser(t, dur, level) { const s = noise(t, dur); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + dur * 0.95); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05); s.connect(f); f.connect(g); g.connect(master); g.connect(send);
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(640, t + dur); const og = ac.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(level * 0.35, t + dur * 0.95); og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05); o.connect(og); og.connect(master); o.start(t); o.stop(t + dur + 0.1); }
  function impact(t, level) { // deep boom + air
    const o = ac.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4); const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2); o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.3);
    const s = noise(t, 1.2); const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(200, t + 1.1); const g2 = ac.createGain(); g2.gain.setValueAtTime(level * 0.5, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.2); s.connect(f); f.connect(g2); g2.connect(master); g2.connect(send); }
  function thump(t, level) { const o = ac.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3); const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); o.connect(g); g.connect(master); g.connect(send); o.start(t); o.stop(t + 0.65); }
  function blip(t, n, level) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n); const g = ac.createGain(); env(g, t, 0.003, level, 0.12); o.connect(g); g.connect(master); g.connect(send); o.start(t); o.stop(t + 0.16); }
  function ping(t, level) { // the notification sound
    [[88, 0], [93, 0.11]].forEach(([n, dt]) => { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n); const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = hz(n) * 2.01; const g = ac.createGain(); env(g, t + dt, 0.004, level, 0.7); const g2 = ac.createGain(); g2.gain.value = 0.15; o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); g.connect(send); o.start(t + dt); o2.start(t + dt); o.stop(t + dt + 0.8); o2.stop(t + dt + 0.8); });
  }
  function scan(t, dur, level) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(900, t); o.frequency.linearRampToValueAtTime(1500, t + dur); const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur); const tr = ac.createOscillator(); tr.frequency.value = 18; const tg = ac.createGain(); tg.gain.value = level * 0.6; tr.connect(tg); tg.connect(g.gain); o.connect(g); g.connect(master); o.start(t); tr.start(t); o.stop(t + dur + 0.05); tr.stop(t + dur + 0.05); }

  // Chords (MIDI).
  const Am = [57, 60, 64, 71], F = [53, 57, 60, 64], C = [55, 60, 64, 67], G = [55, 59, 62, 67], Dm = [53, 57, 62, 65], E = [56, 59, 64, 68], Cmaj9 = [48, 55, 59, 62, 64];
  const ROOT = { Am: 45, F: 41, C: 48, G: 43, Dm: 38, E: 40 };

  // ===== 1. Hook (0–11): dark drone, heartbeat, the warming counter, the reveal.
  drone(T(0), 9.2, 33, 0.22);
  { const s = noise(T(0), 9); const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; const g = ac.createGain(); g.gain.setValueAtTime(0.0001, T(0)); g.gain.linearRampToValueAtTime(0.05, T(3)); g.gain.linearRampToValueAtTime(0.0001, T(9)); s.connect(f); f.connect(g); g.connect(master); }
  pad(T(1.0), 7.6, [45, 52, 60, 64], 0.16, music, 700);
  for (const s of [1.0, 1.6, 4.3]) { thump(T(s), 0.35); whoosh(T(s - 0.25), 0.08, 0.9); }
  bell(T(2.2), 76, 0.05); bell(T(5.2), 72, 0.05);
  [6.5, 7.1, 7.7].forEach((s, i) => { thump(T(s), 0.5); blip(T(s), 64 + i * 3, 0.05); });
  scan(T(6.5), 2.1, 0.03);
  riser(T(6.4), 2.55, 0.2);
  impact(T(8.95), 0.9); whoosh(T(8.7), 0.18, 0.9);
  pad(T(8.95), 2.6, Cmaj9, 0.3, music, 2400);
  [84, 88, 91, 96].forEach((n, i) => bell(T(9.1 + i * 0.12), n, 0.06));

  // ===== 2. Technology (11–25): Am–F–C–G, arpeggio, then a soft beat.
  whoosh(T(10.8), 0.12);
  const prog1 = ['Am', 'F', 'C', 'G'], ch1 = [Am, F, C, G];
  for (let b = 0; b < 6; b++) {
    const t0 = 11 + b * BAR; if (t0 >= 25) break; const i = b % 4;
    pad(T(t0), BAR, ch1[i], 0.2);
    for (let s = 0; s < 8; s++) pluck(T(t0 + s * BEAT / 2), ch1[i][[0, 1, 2, 3, 2, 1, 2, 3][s]] + 12, s % 2 ? 0.05 : 0.08, 2600);
    for (let k = 0; k < 4; k++) { if (t0 + k * BEAT >= 25) break; bass(T(t0 + k * BEAT), ROOT[prog1[i]], BEAT * 0.8, k === 0 ? 0.3 : 0.18); if (b >= 2) { if (k % 2 === 0) kick(T(t0 + k * BEAT), 0.4); hat(T(t0 + k * BEAT + BEAT / 2), 0.035); } }
  }
  [13.0, 14.1, 15.2].forEach((s, i) => { blip(T(s), 76 + i * 2, 0.06); whoosh(T(s - 0.1), 0.04, 0.5); });
  for (let s = 17.6; s < 24.5; s += 0.9) blip(T(s), 88, 0.018); // packets
  whoosh(T(17.0), 0.07); riser(T(22.6), 2.4, 0.12);

  // ===== 3. The app (25–45): full groove, F–G–Am–C.
  impact(T(25.0), 0.4); whoosh(T(24.8), 0.16);
  const prog2 = ['F', 'G', 'Am', 'C'], ch2 = [F, G, Am, C];
  for (let b = 0; b < 9; b++) {
    const t0 = 25 + b * BAR; if (t0 >= 45) break; const i = b % 4;
    pad(T(t0), BAR, ch2[i], 0.22, music, 1800);
    for (let s = 0; s < 16; s++) { const ts = t0 + s * BEAT / 4; if (ts >= 45) break; if (s % 2 && b < 2) continue; pluck(T(ts), ch2[i][[0, 1, 2, 3, 2, 3, 1, 2, 0, 1, 2, 3, 3, 2, 1, 2][s]] + 12, s % 4 === 0 ? 0.08 : 0.05, 3400); }
    for (let k = 0; k < 4; k++) {
      const tb = t0 + k * BEAT; if (tb >= 45) break;
      kick(T(tb), k % 2 === 0 ? 0.6 : 0.25); if (k % 2) clap(T(tb), 0.13);
      hat(T(tb + BEAT / 2), 0.05); hat(T(tb + BEAT * 0.75), 0.025);
      bass(T(tb), ROOT[prog2[i]], BEAT * 0.45, 0.3); bass(T(tb + BEAT / 2), ROOT[prog2[i]] + 12, BEAT * 0.3, 0.16);
    }
  }
  [31.0, 31.22, 31.44, 31.66].forEach((s, i) => { whoosh(T(s), 0.05, 0.45); blip(T(s + 0.3), 79 + i * 2, 0.04); });
  whoosh(T(35.7), 0.13); scan(T(36.0), 2.4, 0.02); whoosh(T(40.3), 0.13);
  riser(T(42.8), 2.2, 0.12);

  // ===== 4. Monitoring & alerts (45–65): tension, then relief.
  mf.frequency.setValueAtTime(18000, T(44.9)); mf.frequency.exponentialRampToValueAtTime(900, T(45.6)); mf.frequency.setValueAtTime(900, T(56.5)); mf.frequency.exponentialRampToValueAtTime(18000, T(58));
  impact(T(45.0), 0.35);
  const prog3 = ['Dm', 'E', 'Am', 'E'], ch3 = [Dm, E, Am, E];
  for (let b = 0; b < 5; b++) {
    const t0 = 45 + b * BAR; if (t0 >= 57) break; const i = b % 4;
    pad(T(t0), BAR, ch3[i], 0.26);
    for (let k = 0; k < 8; k++) bass(T(t0 + k * BEAT / 2), ROOT[prog3[i]], BEAT * 0.35, 0.26);
    for (let k = 0; k < 4; k++) if (k % 2 === 0) kick(T(t0 + k * BEAT), 0.32);
  }
  scan(T(46.4), 2.4, 0.03);
  thump(T(48.8), 0.6); [0, 0.32, 0.64].forEach(d => blip(T(48.8 + d), 81, 0.07)); // the breach
  whoosh(T(51.4), 0.12);
  ping(T(52.9), 0.22);
  // relief: F–G–C–C, groove back.
  const prog4 = ['F', 'G', 'C', 'C'], ch4 = [F, G, C, C];
  for (let b = 0; b < 4; b++) {
    const t0 = 57 + b * BAR; if (t0 >= 65) break; const i = b % 4;
    pad(T(t0), BAR, ch4[i], 0.24, music, 2000);
    for (let s = 0; s < 8; s++) pluck(T(t0 + s * BEAT / 2), ch4[i][[0, 1, 2, 3, 2, 1, 2, 3][s]] + 12, 0.06, 3200);
    for (let k = 0; k < 4; k++) { const tb = t0 + k * BEAT; if (tb >= 65) break; kick(T(tb), k % 2 === 0 ? 0.5 : 0.2); if (k % 2) clap(T(tb), 0.1); hat(T(tb + BEAT / 2), 0.04); bass(T(tb), ROOT[prog4[i]], BEAT * 0.5, 0.26); }
  }
  whoosh(T(57.6), 0.12); [59.4, 59.6].forEach(s => blip(T(s), 86, 0.05));
  ping(T(60.8), 0.15); ping(T(61.9), 0.13);
  riser(T(62.8), 2.2, 0.14);

  // ===== 5. Reveal (65–80): build, final hit, ring out.
  whoosh(T(65.0), 0.16); impact(T(65.0), 0.3);
  for (let b = 0; b < 3; b++) {
    const t0 = 65 + b * BAR; const i = b % 4;
    pad(T(t0), BAR, ch1[i], 0.24, music, 2200);
    for (let s = 0; s < 16; s++) { const ts = t0 + s * BEAT / 4; if (ts >= 71) break; pluck(T(ts), ch1[i][[0, 1, 2, 3, 2, 3, 1, 2, 0, 1, 2, 3, 3, 2, 1, 2][s]] + 12, 0.06 + b * 0.01, 3800); }
    for (let k = 0; k < 4; k++) { const tb = t0 + k * BEAT; if (tb >= 70.9) break; kick(T(tb), 0.5); hat(T(tb + BEAT / 2), 0.05, k === 3); bass(T(tb), ROOT[prog1[i]], BEAT * 0.5, 0.26); }
  }
  riser(T(69.1), 1.95, 0.22);
  impact(T(71.05), 1.0); whoosh(T(70.8), 0.2, 1.0);
  pad(T(71.05), 7.5, Cmaj9, 0.4, music, 2600); drone(T(71.05), 8, 36, 0.18);
  [84, 88, 91, 95, 96].forEach((n, i) => bell(T(71.2 + i * 0.16), n, 0.06));
  [72.4, 74.0, 74.8].forEach((s, i) => blip(T(s), 84 + i * 3, 0.03));
  bell(T(76.5), 72, 0.05); bell(T(76.7), 79, 0.04);
  return dest ? dest.stream.getAudioTracks()[0] : null;
};
