// Original score for the launch film (Web Audio, synthesised — no samples or licensed music).
// 120 BPM from the end of the intro; built from the edit's cues so every cut sits on the beat.
window.buildLaunchScore = function (ac, start, cues, sink) {
  const T = s => start + s, BEAT = 0.5, BAR = 2;
  const master = ac.createGain(); master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -15; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.25;
  master.connect(comp); comp.connect(sink);
  master.gain.setValueAtTime(0.0001, T(cues.introEnd - 0.05)); master.gain.exponentialRampToValueAtTime(0.9, T(cues.introEnd + 0.02));
  master.gain.setValueAtTime(0.9, T(cues.total - 2.2)); master.gain.exponentialRampToValueAtTime(0.0001, T(cues.total - 0.02));
  const music = ac.createGain(); const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 18000; music.connect(mf); mf.connect(master);
  const verb = ac.createConvolver(); const L = Math.floor(ac.sampleRate * 2.8), ir = ac.createBuffer(2, L, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let s = 99 + ch; for (let i = 0; i < L; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647 * 2 - 1) * Math.pow(1 - i / L, 3); } }
  verb.buffer = ir; const send = ac.createGain(); send.gain.value = 0.3; send.connect(verb); verb.connect(master);
  const delay = ac.createDelay(2); delay.delayTime.value = BEAT * 0.75; const fb = ac.createGain(); fb.gain.value = 0.28; const dlf = ac.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 3000;
  delay.connect(dlf); dlf.connect(fb); fb.connect(delay); dlf.connect(music); dlf.connect(send);
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); { const d = nb.getChannelData(0); let s = 7; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 2147483647 * 2 - 1; } }
  const noise = (t, dur) => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.start(t, 0.3); s.stop(t + dur + 0.05); return s; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const osc = (type, f, t, d) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(t + d); return o; };

  function pad(t, dur, notes, level, cutoff = 1600) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + 0.25); g.gain.setValueAtTime(level, t + dur - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5); f.connect(g); g.connect(music); g.connect(send);
    for (const n of notes) for (const dt of [-9, 9]) { const o = osc('sawtooth', hz(n), t, dur + 0.7); o.detune.value = dt; const og = ac.createGain(); og.gain.value = 0.035; o.connect(og); og.connect(f); } }
  function pluck(t, n, level, bright = 3600) { const o = osc('square', hz(n), t, 0.3); const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(bright, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.18); const g = ac.createGain(); env(g, t, 0.003, level, 0.2); o.connect(f); f.connect(g); g.connect(music); g.connect(delay); }
  function bass(t, n, dur, level) { const o = osc('sawtooth', hz(n), t, dur + 0.1), o2 = osc('sine', hz(n - 12), t, dur + 0.1); const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + dur); const g = ac.createGain(); env(g, t, 0.008, level, dur); const g2 = ac.createGain(); g2.gain.value = 0.9; o.connect(f); f.connect(g); o2.connect(g2); g2.connect(g); g.connect(music); }
  function kick(t, level) { const o = ac.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g); g.connect(music); o.start(t); o.stop(t + 0.32);
    const c = noise(t, 0.02), cf = ac.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 3000; const cg = ac.createGain(); cg.gain.setValueAtTime(level * 0.25, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.015); c.connect(cf); cf.connect(cg); cg.connect(music); }
  function clap(t, level) { for (const d of [0, 0.012, 0.024]) { const s = noise(t + d, 0.2); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.9; const g = ac.createGain(); g.gain.setValueAtTime(level, t + d); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16); s.connect(f); f.connect(g); g.connect(music); g.connect(send); } }
  function hat(t, level, open = false) { const s = noise(t, open ? 0.3 : 0.05); const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000; const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.26 : 0.04)); s.connect(f); f.connect(g); g.connect(music); }
  function crash(t, level) { const s = noise(t, 2.2); const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000; const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2); s.connect(f); f.connect(g); g.connect(master); g.connect(send); }
  function boom(t, level) { const o = ac.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(30, t + 1); const g = ac.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4); o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.5); }
  function whoosh(t, level, dur = 0.5) { const s = noise(t, dur); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(4500, t + dur * 0.7); const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); const p = ac.createStereoPanner(); p.pan.setValueAtTime(-0.7, t); p.pan.linearRampToValueAtTime(0.7, t + dur); s.connect(f); f.connect(g); g.connect(p); p.connect(master); p.connect(send); }
  function riser(t, dur, level) { const s = noise(t, dur); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + dur); const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + dur * 0.97); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03); s.connect(f); f.connect(g); g.connect(master); g.connect(send);
    for (let i = 0; i < dur / 0.125; i++) { const tt = t + i * 0.125; if (i * 0.125 > dur * 0.5) { const sn = noise(tt, 0.06), sf = ac.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1800; const sg = ac.createGain(); sg.gain.setValueAtTime(level * 0.35 * (i * 0.125 / dur), tt); sg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05); sn.connect(sf); sf.connect(sg); sg.connect(music); } } }
  function tick(t, level) { const o = osc('sine', 2600, t, 0.05); o.frequency.exponentialRampToValueAtTime(1400, t + 0.03); const g = ac.createGain(); env(g, t, 0.002, level, 0.04); o.connect(g); g.connect(master); }
  function ping(t, level) { [[88, 0], [95, 0.1]].forEach(([n, d]) => { const o = osc('sine', hz(n), t + d, 0.8), o2 = osc('sine', hz(n) * 2.01, t + d, 0.8); const g = ac.createGain(); env(g, t + d, 0.004, level, 0.6); const g2 = ac.createGain(); g2.gain.value = 0.15; o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); g.connect(send); }); }
  function bell(t, n, level) { for (const [m, l] of [[1, 1], [2.76, 0.3], [5.4, 0.1]]) { const o = osc('sine', hz(n) * m, t, 2.4); const g = ac.createGain(); env(g, t, 0.004, level * l, 2.2); o.connect(g); g.connect(master); g.connect(send); } }

  const F = [53, 57, 60, 64], G = [55, 59, 62, 67], Am = [57, 60, 64, 71], C = [55, 60, 64, 67], Cmaj9 = [48, 55, 59, 62, 64];
  const GROOVE = [[F, 41], [G, 43], [Am, 45], [C, 48]], BUILD = [[Am, 45], [F, 41], [C, 48], [G, 43]];
  const ARP = [0, 1, 2, 3, 2, 3, 1, 2, 0, 1, 2, 3, 3, 2, 1, 2];
  let bar = 0;
  function grooveBar(t0, o = {}) {
    const [ch, root] = (o.prog ?? GROOVE)[bar++ % 4];
    pad(T(t0), BAR, ch, o.padLevel ?? 0.18, o.bright ? 2600 : 1700);
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * BEAT;
      if (!o.noDrums) { kick(T(tb), 0.62); if (b % 2) clap(T(tb), 0.12); hat(T(tb + BEAT / 2), 0.05, b === 3); hat(T(tb + BEAT * 0.25), 0.02); hat(T(tb + BEAT * 0.75), 0.025); }
      bass(T(tb + BEAT / 2), root, BEAT * 0.4, 0.26); if (b === 0) bass(T(tb), root, BEAT * 0.3, 0.2);
    }
    for (let s = 0; s < 16; s++) pluck(T(t0 + s * BEAT / 4), ch[ARP[s]] + 12, s % 4 === 0 ? 0.055 : 0.032, o.bright ? 4800 : 3400);
  }

  const shots = cues.shots;
  shots.forEach((s, i) => {
    const bars = Math.round((s.t1 - s.t0) / BAR), next = shots[i + 1];
    if (s.type === 'title') {
      boom(T(s.t0), 0.55); crash(T(s.t0), 0.14); kick(T(s.t0), 0.8); whoosh(T(s.t0 - 0.35), 0.16, 0.6);
      const [ch] = GROOVE[bar % 4]; pad(T(s.t0), BAR, [...ch, ch[0] + 12], 0.26, 3000);
      for (let b = 1; b < 4; b++) hat(T(s.t0 + b * BEAT), 0.03 + b * 0.015, b === 3);
      bell(T(s.t0 + 0.05), 84, 0.035);
    } else if (s.type === 'scene' && i === shots.length - 1) {
      // The ending: the hit on the first beat, then the last chord rings out.
      boom(T(s.t0), 0.9); crash(T(s.t0), 0.2); kick(T(s.t0), 0.9);
      pad(T(s.t0), bars * BAR - 1, Cmaj9, 0.32, 2600);
      [84, 88, 91, 95, 96].forEach((n, k) => bell(T(s.t0 + 0.15 + k * 0.16), n, 0.05));
      bell(T(s.t0 + 5.6), 72, 0.04); bell(T(s.t0 + 5.8), 79, 0.035);
    } else if (s.type === 'scene') {
      // The Telegram moment: the groove drops back, the notification lands.
      mf.frequency.setValueAtTime(18000, T(s.t0)); mf.frequency.exponentialRampToValueAtTime(700, T(s.t0 + 0.4)); mf.frequency.setValueAtTime(700, T(s.t1 - 0.4)); mf.frequency.exponentialRampToValueAtTime(18000, T(s.t1));
      for (let b = 0; b < bars; b++) grooveBar(s.t0 + b * BAR, { padLevel: 0.24 });
      ping(T(s.t0 + (52.9 - s.from) / (s.to - s.from) * (s.t1 - s.t0)), 0.26);
    } else if (s.type === 'tech') {
      for (let b = 0; b < bars; b++) { grooveBar(s.t0 + b * BAR, { prog: BUILD, bright: true, padLevel: 0.22 }); bell(T(s.t0 + b * BAR + 0.02), [84, 86, 88, 91][b % 4], 0.04); whoosh(T(s.t0 + b * BAR - 0.3), 0.06, 0.4); }
    } else {
      for (let b = 0; b < bars; b++) grooveBar(s.t0 + b * BAR, { bright: s.type === 'image' || s.type === 'phone' });
    }
    // Risers into the next chapter.
    if (next && next.type === 'title') riser(T(s.t1 - 1), 1, 0.12);
    if (next && (next.type === 'tech' || (next.type === 'scene' && i === shots.length - 2))) riser(T(s.t1 - 2), 2, 0.2);
  });
  for (const t of cues.mails) ping(T(t), 0.18);
  for (const t of cues.clicks) tick(T(t), 0.1);
};
