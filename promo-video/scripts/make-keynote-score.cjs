// Renders the launch film's soundtrack to public/keynote.wav (48 kHz, 16-bit stereo):
// the cinematic intro's score for the first 11 s, then the 90 BPM keynote score built
// from the edit (src/launch/edit.mjs), so the music follows every cut.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
(async () => {
  const { buildEdit } = await import('file:///' + path.join(ROOT, 'src', 'keynote', 'edit.mjs').replace(/\\/g, '/'));
  const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'rec', 'timeline.json'), 'utf8'));
  const { cues, shots } = buildEdit(TL);
  for (const s of cues.shots) { const sh = shots.find(x => Math.abs(x.f0 / 30 - s.t0) < 1e-6); if (sh && sh.type === 'scene') { s.from = sh.from; s.to = sh.to; } }
  const b = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage();
  await p.setContent('<p>score</p>');
  await p.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'src', 'score.js'), 'utf8') });
  await p.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'src', 'keynote', 'keynote-score.js'), 'utf8') });
  const b64 = await p.evaluate(async cues => {
    const SR = 48000, TOTAL = cues.total, ctx = new OfflineAudioContext(2, Math.ceil((TOTAL + 0.3) * SR), SR);
    // The intro's music, faded out at the first beat of the launch section.
    const gate = ctx.createGain(); gate.connect(ctx.destination);
    gate.gain.setValueAtTime(1, cues.introEnd - 0.25); gate.gain.linearRampToValueAtTime(0, cues.introEnd + 0.15);
    window.buildPromoScore(ctx, 0, 80, gate);
    window.buildKeynoteScore(ctx, 0, cues, ctx.destination);
    const buf = await ctx.startRendering(), n = Math.floor(TOTAL * SR), Lc = buf.getChannelData(0), Rc = buf.getChannelData(1);
    const out = new DataView(new ArrayBuffer(44 + n * 4)); const str = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
    out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, Lc[i])) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, Rc[i])) * 32767, true); }
    const bytes = new Uint8Array(out.buffer); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, cues);
  fs.writeFileSync(path.join(ROOT, 'public', 'keynote.wav'), Buffer.from(b64, 'base64'));
  console.log('public/keynote.wav', (cues.total).toFixed(1), 's,', (fs.statSync(path.join(ROOT, 'public', 'keynote.wav')).size / 1e6).toFixed(1), 'MB');
  await b.close();
})();
