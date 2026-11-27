// Renders the original score (src/score.js, Web Audio) to public/score.wav — 48 kHz, 16-bit stereo.
// node scripts/make-score.cjs   (uses Playwright and Chrome, as the app's tests do)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage();
  await p.setContent('<p>score</p>');
  await p.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'src', 'score.js'), 'utf8') });
  const b64 = await p.evaluate(async () => {
    const SR = 48000, TOTAL = 80, ctx = new OfflineAudioContext(2, Math.ceil((TOTAL + 0.2) * SR), SR);
    window.buildPromoScore(ctx, 0.05, TOTAL, ctx.destination);
    const buf = await ctx.startRendering(), n = Math.floor(TOTAL * SR), L = buf.getChannelData(0), R = buf.getChannelData(1);
    const out = new DataView(new ArrayBuffer(44 + n * 4)); const str = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
    out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
    const bytes = new Uint8Array(out.buffer); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(ROOT, 'public', 'score.wav'), Buffer.from(b64, 'base64'));
  console.log('public/score.wav', (fs.statSync(path.join(ROOT, 'public', 'score.wav')).size / 1e6).toFixed(1), 'MB');
  await b.close();
})();
