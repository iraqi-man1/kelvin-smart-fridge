// Kelvin promo scenes (2D canvas + WebGL). Every app screen is a real capture of the running app.
// Kelvin — cinematic promo (80 s, 1920×1080, 30 fps). Every app screen shown is a real
// capture of the running app (Playwright); the graphics around it are motion design.
const W = 1920, H = 1080, FPS = 30, TOTAL = 80;
const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
const g = c.getContext('2d');
const SC = 1;
const SANS = '"IBM Plex Sans", "Segoe UI", sans-serif', MONO = '"IBM Plex Mono", Consolas, monospace';
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", sans-serif';
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const out = k => { k = clamp(k); return 1 - Math.pow(1 - k, 3); };
const outQ = k => { k = clamp(k); return 1 - Math.pow(1 - k, 5); };
const win = (t, a, b, fi = 0.5, fo = 0.5) => Math.min(out((t - a) / fi), 1 - out((t - (b - fo)) / fo)); // fade in/out window
const ACC = '#38bdf8', ACC2 = '#22d3ee', WARN = '#f43f5e', OK = '#34d399';

function loadImg(src) { const i = new Image(); i.crossOrigin = 'anonymous'; i.src = src; return i.decode().then(() => i); }
function rr(x, y, w, h, r, ctx = g) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function text(s, x, y, size, weight, color, { align = 'left', alpha = 1, font = SANS, spacing = 0, blur = 0, glow = null } = {}) {
  if (alpha <= 0.002) return;
  g.save(); g.globalAlpha *= alpha; g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  g.letterSpacing = `${spacing}px`;
  if (blur > 0.2) g.filter = `blur(${blur}px)`;
  if (glow) { g.shadowColor = glow; g.shadowBlur = 28; }
  g.fillText(s, x, y); g.restore();
}

// ---------- WebGL planes (real screenshots in 3D perspective) ----------
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const gl = glc.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
const prog = (() => {
  const vs = `attribute vec2 p; uniform mat4 m; varying vec2 uv; void main(){ uv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = m*vec4(p,0.0,1.0); }`;
  const fs = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform float a; uniform float bright; uniform vec2 size; uniform float radius;
    void main(){ vec2 px = uv*size; vec2 q = abs(px - size*0.5) - (size*0.5 - vec2(radius)); float d = length(max(q,0.0)) - radius;
      float edge = 1.0 - smoothstep(-1.0, 1.0, d); vec4 col = texture2D(tex, uv); gl_FragColor = vec4(col.rgb*bright, 1.0) * edge * a; }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); gl.useProgram(p);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return p;
})();
const U = n => gl.getUniformLocation(prog, n);
const textures = new Map();
function tex(src) {
  if (textures.has(src)) return textures.get(src);
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  textures.set(src, t); return t;
}
// Column-major 4×4 matrices.
const M = {
  mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); },
  tr(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
  sc(x, y, z = 1) { return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]); },
  rx(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  ry(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  rz(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
};
const FOV = 30 * Math.PI / 180, DIST = (H / 2) / Math.tan(FOV / 2);
const PROJ = M.persp(FOV, W / H, 10, 20000);
const deg = d => d * Math.PI / 180;
// A plane w×h px centred at screen (x, y) (from the centre), depth z (negative = farther), rotations in degrees.
function planeMatrix({ x = 0, y = 0, z = 0, w, h, rx = 0, ry = 0, rz = 0 }) {
  let m = M.mul(PROJ, M.tr(0, 0, -DIST));
  m = M.mul(m, M.tr(x, -y, z)); m = M.mul(m, M.ry(deg(ry))); m = M.mul(m, M.rx(deg(rx))); m = M.mul(m, M.rz(deg(rz)));
  return M.mul(m, M.sc(w / 2, h / 2));
}
function project(m, px, py) { // object space (-1..1) → screen px
  const x = m[0] * px + m[4] * py + m[12], y = m[1] * px + m[5] * py + m[13], w = m[3] * px + m[7] * py + m[15];
  return [(x / w * 0.5 + 0.5) * W, (0.5 - y / w * 0.5) * H];
}
// Draws a real screenshot as a 3D plane with a soft glow/shadow under it.
function plane(src, o) {
  const a = o.alpha ?? 1; if (a <= 0.003) return;
  const m = planeMatrix(o);
  const pts = [project(m, -1, -1), project(m, 1, -1), project(m, 1, 1), project(m, -1, 1)];
  g.save(); g.globalAlpha = a * (o.shadow ?? 0.85);
  g.shadowColor = o.glow || 'rgba(56,189,248,.35)'; g.shadowBlur = 90; g.shadowOffsetY = 30;
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = 'rgba(8,12,22,1)'; g.fill(); g.restore();
  gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindTexture(gl.TEXTURE_2D, tex(src));
  gl.uniformMatrix4fv(U('m'), false, m); gl.uniform1f(U('a'), a); gl.uniform1f(U('bright'), o.bright ?? 1);
  gl.uniform2f(U('size'), o.w, o.h); gl.uniform1f(U('radius'), o.radius ?? 18);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  g.drawImage(glc, 0, 0);
  // A thin light edge.
  g.save(); g.globalAlpha = a * 0.5; g.strokeStyle = 'rgba(148,197,255,.55)'; g.lineWidth = 1.2;
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); g.restore();
  return pts;
}

// ---------- Atmosphere ----------
let pseed = 12345; const prand = () => (pseed = (pseed * 16807) % 2147483647) / 2147483647;
const parts = Array.from({ length: 260 }, () => ({ x: prand() * W, y: prand() * H, z: prand(), s: prand() * 2 + 0.4, p: prand() * 6.28, v: prand() * 0.6 + 0.2 }));
function particles(t, alpha = 1, color = '190,230,255', drift = 1) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const q of parts) {
    const x = (q.x + t * 14 * q.v * drift * (0.4 + q.z)) % (W + 40) - 20, y = (q.y + Math.sin(t * 0.4 + q.p) * 18 - t * 6 * q.z * drift + H * 4) % H;
    const r = q.s * (0.6 + q.z * 1.8), a = alpha * (0.15 + q.z * 0.55) * (0.6 + 0.4 * Math.sin(t * 1.3 + q.p));
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 4); gr.addColorStop(0, `rgba(${color},${a})`); gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr; g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  }
  g.restore();
}
function glow(x, y, r, color, alpha = 1) {
  if (alpha <= 0) return; g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = alpha;
  const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
}
function bg(t, top = '#05070d', bottom = '#0a1426') {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  glow(W * 0.22 + Math.sin(t * 0.21) * 80, H * 0.3, 700, 'rgba(37,99,235,.22)');
  glow(W * 0.82 + Math.cos(t * 0.17) * 70, H * 0.78, 760, 'rgba(34,211,238,.13)');
}
function floorGrid(t, alpha) {
  if (alpha <= 0) return; g.save(); g.globalAlpha = alpha; g.strokeStyle = 'rgba(56,189,248,.16)'; g.lineWidth = 1;
  const hy = 700, vx = W / 2;
  for (let i = -16; i <= 16; i++) { g.beginPath(); g.moveTo(vx + i * 40, hy); g.lineTo(vx + i * 260, H); g.stroke(); }
  for (let k = 0; k < 14; k++) { const p = ((k + (t * 0.35) % 1) / 14); const y = hy + Math.pow(p, 2.2) * (H - hy); g.globalAlpha = alpha * p; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.restore();
  const fade = g.createLinearGradient(0, hy - 40, 0, hy + 120); fade.addColorStop(0, 'rgba(6,10,20,1)'); fade.addColorStop(1, 'rgba(6,10,20,0)'); g.fillStyle = fade; g.fillRect(0, hy - 40, W, 160);
}
let grainCanvas;
function finish(t) {
  // Vignette and a little film grain.
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.save(); g.globalAlpha = 0.05; g.globalCompositeOperation = 'overlay';
  const ox = (Math.floor(t * 30) * 137) % 256, oy = (Math.floor(t * 30) * 71) % 256;
  g.translate(-ox, -oy); g.fillStyle = g.createPattern(grainCanvas, 'repeat'); g.fillRect(0, 0, W + 256, H + 256); g.restore();
}
// Lower-left cinematic title: a small eyebrow, a big line, an optional sub line.
function title(t, a, b, eyebrow, big, sub, { x = 120, y = 860, color = '#fff' } = {}) {
  const k = win(t, a, b, 0.8, 0.6); if (k <= 0) return;
  const s = (1 - out((t - a) / 0.9)) * 24;
  text(eyebrow, x, y - 78, 20, 600, ACC2, { alpha: k, spacing: 5, font: MONO });
  text(big, x, y + s * 0.4, 58, 600, color, { alpha: k, spacing: -0.5, blur: (1 - out((t - a) / 0.7)) * 8 });
  if (sub) text(sub, x + 2, y + 52, 26, 400, 'rgba(203,213,225,.92)', { alpha: k * out((t - a - 0.25) / 0.8) });
  g.save(); g.globalAlpha = k; g.fillStyle = ACC2; g.fillRect(x, y - 64, 46 * out((t - a) / 0.8), 3); g.restore();
}
function badge(alpha) { if (alpha <= 0) return; text('Real app · sample data', W - 60, H - 46, 18, 500, 'rgba(203,213,225,.7)', { align: 'right', alpha, font: MONO, spacing: 1 }); }

// ---------- Assets ----------
const A = {};
const FR = { dash: 'f02209.jpg', arabic: 'f02216.jpg', energy: 'f00970.jpg', alerts: 'f01064.jpg', system: 'f01324.jpg', phone: 'f02275.jpg', phone2: 'f02315.jpg', phoneEnergy: 'f02409.jpg' };
function crop(img, x, y, w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h); return cv; }
function keyWhite(img) { // the fridge render on a transparent background
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, cv.width, cv.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const mn = Math.min(p[i], p[i + 1], p[i + 2]), mx = Math.max(p[i], p[i + 1], p[i + 2]); const light = mn > 226 && mx - mn < 14; if (light) p[i + 3] = Math.round(clamp((248 - mn) / 22) * 255); }
  x.putImageData(d, 0, 0); return cv;
}

// ================= SCENES =================
// 1 — The hook (0–11 s)
function sceneHook(t) {
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const light = out(t / 2.5);
  glow(W / 2, -120, 900, 'rgba(56,130,246,.30)', light * (1 - out((t - 8.4) / 0.6) * 0.3));
  particles(t, light * 0.9);
  const k1 = win(t, 1.0, 4.1, 0.9, 0.5);
  text('Around a third of the world’s food', W / 2, 500, 64, 300, '#e2e8f0', { align: 'center', alpha: k1, spacing: 1, blur: (1 - out((t - 1) / 0.9)) * 10 });
  text('is lost or wasted.', W / 2, 584, 64, 600, '#ffffff', { align: 'center', alpha: win(t, 1.6, 4.1, 0.9, 0.5), spacing: 1, blur: (1 - out((t - 1.6) / 0.9)) * 10 });
  const k2 = win(t, 4.3, 6.4, 0.7, 0.4);
  text('Much of it spoils quietly — in storage.', W / 2, 545, 58, 300, '#e2e8f0', { align: 'center', alpha: k2, spacing: 1, blur: (1 - out((t - 4.3) / 0.7)) * 10 });
  // The fridge warming up unnoticed: a counter from 4.0 to 11.6 °C, cold blue to red.
  if (t > 6.4 && t < 8.9) {
    const k = win(t, 6.45, 8.8, 0.3, 0.3), p = ease((t - 6.5) / 2.0), temp = lerp(4.0, 11.6, p);
    const col = `rgb(${Math.round(lerp(56, 244, p))},${Math.round(lerp(189, 63, p))},${Math.round(lerp(248, 94, p))})`;
    glow(1300, 520, 420, col.replace('rgb', 'rgba').replace(')', ',.28)'), k);
    text(temp.toFixed(1), 1300, 590, 210, 300, col, { align: 'center', alpha: k, font: MONO, glow: col });
    text('°C', 1300 + 260, 520, 60, 300, col, { alpha: k, font: MONO });
    ['Too warm.', 'Too humid.', 'Unnoticed.'].forEach((s, i) => text(s, 360, 440 + i * 92, 70, i === 2 ? 700 : 300, i === 2 ? '#fff' : '#cbd5e1', { alpha: k * out((t - 6.5 - i * 0.6) / 0.25) }));
  }
  // Reveal: a light streak, then the name.
  const sk = (t - 8.75) / 0.7;
  if (sk > 0 && sk < 1.4) {
    const x = lerp(-400, W + 400, ease(sk));
    g.save(); g.globalCompositeOperation = 'lighter';
    const lg = g.createLinearGradient(x - 500, 0, x + 500, 0); lg.addColorStop(0, 'rgba(56,189,248,0)'); lg.addColorStop(0.5, 'rgba(220,240,255,.95)'); lg.addColorStop(1, 'rgba(56,189,248,0)');
    g.fillStyle = lg; g.fillRect(x - 500, H / 2 - 3, 1000, 6); glow(x, H / 2, 260, 'rgba(147,197,253,.55)'); g.restore();
  }
  if (t > 9.0) {
    const k = out((t - 9.0) / 0.9), s = lerp(1.25, 1, outQ((t - 9.0) / 1.6));
    glow(W / 2, 480, 520, 'rgba(37,99,235,.35)', k);
    g.save(); g.globalAlpha = k; g.translate(W / 2, 400); g.scale(s, s); g.shadowColor = 'rgba(56,189,248,.7)'; g.shadowBlur = 50; g.drawImage(A.logo, -64, -64, 128, 128); g.restore();
    text('Kelvin', W / 2, 610, 150, 700, '#fff', { align: 'center', alpha: k, spacing: lerp(40, -2, outQ((t - 9.0) / 1.8)) });
    text('SMART FRIDGE MONITOR', W / 2, 676, 24, 500, ACC2, { align: 'center', alpha: out((t - 9.7) / 0.8), spacing: 10, font: MONO });
  }
  const flash = (t > 8.95 && t < 9.5) ? 1 - (t - 8.95) / 0.55 : 0;
  if (flash > 0) { g.fillStyle = `rgba(220,235,255,${flash * 0.55})`; g.fillRect(0, 0, W, H); }
}

// 2 — The technology (11–25 s)
function sceneTech(t) {
  bg(t, '#03060d', '#081224'); floorGrid(t, out(t / 2) * 0.9); particles(t + 11, 0.35);
  const fx = lerp(640, 470, ease((t - 6.2) / 1.4)), fy = 520, fa = out(t / 1.6), fs = lerp(0.9, 1, outQ(t / 2.5));
  glow(fx, fy - 40, 520, 'rgba(56,130,246,.32)', fa);
  g.save(); g.globalAlpha = fa; g.translate(fx, fy + Math.sin(t * 1.2) * 6); g.scale(fs, fs);
  g.shadowColor = 'rgba(56,189,248,.45)'; g.shadowBlur = 60; g.drawImage(A.fridge, -330, -330, 660, 660); g.restore();
  // Reflection on the floor.
  g.save(); g.globalAlpha = fa * 0.16; g.translate(fx, fy + 640); g.scale(fs, -fs * 0.5); g.drawImage(A.fridge, -330, -330, 660, 660); g.restore();
  // Sensor callouts.
  const calls = [
    [2.0, [fx + 120, fy - 150], [1060, 330], 'DHT11', 'Temperature · humidity'],
    [3.1, [fx + 150, fy - 20], [1060, 500], 'CCS811', 'eCO₂ · TVOC — air quality'],
    [4.2, [fx + 110, fy + 120], [1060, 670], 'ESP32-WROOM-32', 'Reads the sensors · sends over Wi-Fi'],
  ];
  const callOut = 1 - out((t - 6.0) / 0.6);
  for (const [at, [ax, ay], [bx, by], name, sub] of calls) {
    const k = out((t - at) / 0.6) * callOut; if (k <= 0) continue;
    g.save(); g.globalAlpha = k; g.strokeStyle = 'rgba(125,211,252,.8)'; g.lineWidth = 2;
    const mx = lerp(ax, bx - 40, out((t - at) / 0.6));
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(lerp(ax, bx - 120, out((t - at) / 0.5)), lerp(ay, by, out((t - at) / 0.5))); if (t - at > 0.3) g.lineTo(mx, by); g.stroke();
    g.fillStyle = ACC2; g.beginPath(); g.arc(ax, ay, 6 + Math.sin(t * 5) * 1.5, 0, 7); g.fill(); g.restore();
    glow(ax, ay, 40, 'rgba(34,211,238,.6)', k);
    // A small chip drawing beside the label.
    g.save(); g.globalAlpha = k; rr(bx, by - 34, 64, 52, 8); g.fillStyle = 'rgba(15,23,42,.95)'; g.fill(); g.strokeStyle = 'rgba(125,211,252,.7)'; g.lineWidth = 1.5; g.stroke();
    for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(125,211,252,.7)'; g.fillRect(bx + 10 + i * 13, by - 42, 4, 8); g.fillRect(bx + 10 + i * 13, by + 18, 4, 8); }
    g.restore();
    text(name, bx + 90, by - 4, 40, 600, '#fff', { alpha: k, spacing: 0.5 });
    text(sub, bx + 91, by + 32, 24, 400, '#94a3b8', { alpha: k });
  }
  // Data stream: the real JSON the ESP32 sends, flowing to the API and the database.
  const nk = out((t - 6.6) / 0.8);
  const nodes = [[1180, 380, 'Kelvin API', 'Node.js · Vercel'], [1620, 380, 'Supabase', 'PostgreSQL'], [1400, 640, 'Dashboard', 'browser · phone']];
  const src = [fx + 150, fy - 230];
  if (nk > 0) {
    // Paths.
    const paths = [[src, [1180, 380]], [[1180, 380], [1620, 380]], [[1180, 380], [1400, 640]]];
    g.save(); g.globalAlpha = nk; g.setLineDash([8, 10]); g.lineDashOffset = -t * 40; g.strokeStyle = 'rgba(56,189,248,.45)'; g.lineWidth = 2;
    for (const [[x1, y1], [x2, y2]] of paths) { g.beginPath(); g.moveTo(x1, y1); g.bezierCurveTo(lerp(x1, x2, 0.5), y1 - 80, lerp(x1, x2, 0.5), y2 - 80, x2, y2); g.stroke(); }
    g.restore();
    // Pulses.
    for (let i = 0; i < 9; i++) for (const [[x1, y1], [x2, y2]] of paths) {
      const p = ((t * 0.55 + i / 9) % 1); const u = 1 - p;
      const cx1 = lerp(x1, x2, 0.5), cy1 = y1 - 80, cy2 = y2 - 80;
      const x = u * u * u * x1 + 3 * u * u * p * cx1 + 3 * u * p * p * cx1 + p * p * p * x2, y = u * u * u * y1 + 3 * u * u * p * cy1 + 3 * u * p * p * cy2 + p * p * p * y2;
      glow(x, y, 16, 'rgba(103,232,249,.9)', nk * Math.sin(p * Math.PI));
    }
    for (const [x, y, n, s] of nodes) {
      g.save(); g.globalAlpha = nk; g.shadowColor = 'rgba(56,189,248,.4)'; g.shadowBlur = 30; rr(x - 150, y - 50, 300, 100, 20); g.fillStyle = 'rgba(10,18,36,.92)'; g.fill(); g.shadowColor = 'transparent'; g.strokeStyle = 'rgba(125,211,252,.55)'; g.lineWidth = 1.5; g.stroke(); g.restore();
      text(n, x, y - 2, 32, 600, '#fff', { align: 'center', alpha: nk });
      text(s, x, y + 32, 21, 400, '#94a3b8', { align: 'center', alpha: nk });
    }
    // The packet.
    const pk = win(t, 7.4, 13.6, 0.6, 0.5);
    if (pk > 0) {
      const json = '{"temperature":4.3,"humidity":66.8,"eco2":498,"tvoc":18}';
      g.save(); g.globalAlpha = pk; g.font = `500 21px ${MONO}`; const w = g.measureText(json).width + 40;
      const px = 120 + (1 - out((t - 7.4) / 0.8)) * -40, py = 150;
      rr(px, py, w, 52, 26); g.fillStyle = 'rgba(8,47,73,.85)'; g.fill(); g.strokeStyle = 'rgba(103,232,249,.7)'; g.stroke(); g.restore();
      text(json, 140, 184, 21, 500, '#a5f3fc', { alpha: pk, font: MONO });
      text('POST /api/readings · HTTPS · X-Device-Key', 140, 232, 18, 500, 'rgba(148,163,184,.9)', { alpha: pk, font: MONO, spacing: 1 });
    }
  }
  title(t, 8.6, 13.8, 'THE TECHNOLOGY', 'One secure reading, every minute.', 'ESP32 + DHT11 + CCS811 → Kelvin API → PostgreSQL', { x: 120, y: 900 });
}

// 3 — The real application (25–45 s)
function sceneApp(t) {
  bg(t + 25, '#03060d', '#0b1530'); particles(t + 25, 0.25);
  // a) The dark dashboard flies in.
  if (t < 11.5) {
    const k = win(t, 0, 11.5, 0.8, 0.8), p = outQ(t / 4.2);
    const back = ease((t - 5.6) / 1.4); // pushes back for the cards
    plane(A.dash, { w: 1920 * 0.78, h: 1080 * 0.78, x: lerp(260, 70, p) - back * 120, y: lerp(60, 10, p), z: lerp(-1700, -120, p) - back * 650, ry: lerp(-34, -12, p) + Math.sin(t * 0.4) * 1.5 - back * 6, rx: lerp(12, 4, p), rz: lerp(-3, 0, p), alpha: k, bright: lerp(1, 0.55, back), radius: 22 });
    title(t, 0.9, 5.8, 'REAL-TIME DASHBOARD', 'Live readings at a glance.', 'Every number here comes from the device', { x: 120, y: 900 });
    // b) The four sensor cards lift out of the screen.
    const cards = ['temp', 'hum', 'eco2', 'tvoc'];
    cards.forEach((key, i) => {
      const a0 = 6.0 + i * 0.22, k2 = out((t - a0) / 0.9) * (1 - out((t - 10.6) / 0.8));
      if (k2 <= 0) return;
      const tx = -555 + i * 370, ty = -40 + Math.sin(t * 0.9 + i) * 10;
      plane(A[key], { w: 366 * 0.98, h: 169 * 0.98, x: lerp(tx * 0.6, tx, out((t - a0) / 1.1)), y: lerp(160, ty, out((t - a0) / 1.1)), z: lerp(-500, 60, outQ((t - a0) / 1.2)), ry: (i - 1.5) * -7, rx: 6, alpha: k2, radius: 14, glow: 'rgba(56,189,248,.5)' });
    });
    title(t, 6.4, 11.0, 'FOUR SENSORS', 'Temperature, humidity and air quality.', 'Limits you set — shown on every card', { x: 120, y: 900 });
  }
  // c) The chart, revealed by a scanning light.
  if (t > 10.8 && t < 15.9) {
    const k = win(t, 10.8, 15.9, 0.6, 0.6), p = ease((t - 11.0) / 2.6);
    const w = 1006 * 1.55, h = 371 * 1.55;
    const pts = plane(A.chart, { w, h, x: 40, y: -70, z: lerp(-260, 0, outQ((t - 10.8) / 1.6)), ry: lerp(10, 4, out((t - 10.8) / 3)), rx: 4, alpha: k, radius: 16 });
    // Cover the part not yet revealed, and draw the scan line.
    if (pts && p < 1) {
      const [tl, tr, br, bl] = pts; const sx = lerp(tl[0], tr[0], p), sx2 = lerp(bl[0], br[0], p), sy = lerp(tl[1], tr[1], p), sy2 = lerp(bl[1], br[1], p);
      g.save(); g.globalAlpha = k; g.beginPath(); g.moveTo(sx, sy); g.lineTo(tr[0], tr[1]); g.lineTo(br[0], br[1]); g.lineTo(sx2, sy2); g.closePath(); g.fillStyle = '#060b18'; g.fill();
      g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(165,243,252,.95)'; g.lineWidth = 3; g.shadowColor = ACC2; g.shadowBlur = 30; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx2, sy2); g.stroke(); g.restore();
    }
    title(t, 11.4, 15.8, 'HISTORY & FORECAST', '24 hours to 7 days — and the next 6.', 'The dashed line is your alert limit', { x: 120, y: 980 });
  }
  // d) Energy and the phone.
  if (t > 15.4) {
    const k = win(t, 15.4, 20.4, 0.7, 0.6), p = outQ((t - 15.4) / 2.4);
    plane(A.energy, { w: 1920 * 0.62, h: 1080 * 0.62, x: lerp(-420, -200, p), y: -60, z: lerp(-900, -260, p), ry: lerp(-30, -18, p), rx: 3, alpha: k, radius: 18 });
    plane(A.phone, { w: 390 * 1.08, h: 844 * 1.08, x: lerp(900, 600, p), y: lerp(80, -10, p) + Math.sin(t * 0.8) * 8, z: lerp(-300, 0, p), ry: lerp(26, 14, p), rx: 2, alpha: k, radius: 40, glow: 'rgba(56,189,248,.55)' });
    title(t, 16.0, 20.4, 'ENERGY · ANY SCREEN', 'Power per part — in Wh or mAh.', 'Phone, tablet or desktop · Arabic, English, Malay', { x: 120, y: 990 });
  }
  badge(win(t, 0.5, 20, 1, 0.6));
}

// 4 — Smart monitoring & alerts (45–65 s)
const NOTE1 = ['⚠️ Temperature rose above the limit', 'Reading: 8.1 °C', 'Limit: 8 °C', 'Device: ESP32-WROOM-32', 'Time: 7:21 PM'];
const NOTE2 = ['✅ Temperature is back to normal: 7.8 °C'];
// Wraps notification lines the way a phone does; returns [text, lineIndex] pairs.
function wrapLines(src, nw, s) {
  const lines = [];
  src.forEach((l, j) => { g.font = `${j ? 400 : 600} ${(j ? 23 : 25) * s}px ${SANS}, ${EMOJI}`; let cur = ''; for (const w of l.split(' ')) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > nw - 56 * s && cur) { lines.push([cur, j]); cur = w; } else cur = t; } lines.push([cur, j]); });
  return lines;
}
function phoneMock(x, y, s, alpha, t, notes) {
  if (alpha <= 0) return;
  const w = 430 * s, h = 880 * s;
  g.save(); g.globalAlpha = alpha; g.translate(x, y);
  g.shadowColor = 'rgba(56,189,248,.35)'; g.shadowBlur = 80; rr(-w / 2 - 14 * s, -h / 2 - 14 * s, w + 28 * s, h + 28 * s, 70 * s); g.fillStyle = '#0b0f19'; g.fill(); g.shadowColor = 'transparent';
  g.strokeStyle = 'rgba(148,163,184,.35)'; g.lineWidth = 2; g.stroke();
  rr(-w / 2, -h / 2, w, h, 56 * s); g.save(); g.clip();
  const lg = g.createLinearGradient(0, -h / 2, 0, h / 2); lg.addColorStop(0, '#0f2547'); lg.addColorStop(0.55, '#0a1630'); lg.addColorStop(1, '#050a16'); g.fillStyle = lg; g.fillRect(-w / 2, -h / 2, w, h);
  glow(-w * 0.2, -h * 0.2, w, 'rgba(56,189,248,.25)');
  text('7:21', 0, -h / 2 + 190 * s, 120 * s, 300, '#fff', { align: 'center' });
  text('Thursday, 27 November', 0, -h / 2 + 238 * s, 26 * s, 400, 'rgba(226,232,240,.85)', { align: 'center' });
  let stackY = 300 * s;
  notes.forEach((n, i) => {
    const k = out((t - n.at) / 0.6); if (k <= 0) return;
    const nw = w - 36 * s, wrapped = wrapLines(n.lines, nw, s), nh = (104 + wrapped.length * 30) * s;
    const ny = -h / 2 + stackY - (1 - k) * 120 * s; stackY += nh + 18 * s;
    g.save(); g.globalAlpha = alpha * k; rr(-nw / 2, ny, nw, nh, 26 * s); g.fillStyle = 'rgba(30,41,59,.82)'; g.fill(); g.strokeStyle = 'rgba(148,163,184,.25)'; g.stroke();
    // App icon: a paper plane, like the one the dashboard uses for Telegram.
    g.fillStyle = '#2aa3e0'; g.beginPath(); g.arc(-nw / 2 + 44 * s, ny + 42 * s, 22 * s, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-nw / 2 + 32 * s, ny + 42 * s); g.lineTo(-nw / 2 + 56 * s, ny + 31 * s); g.lineTo(-nw / 2 + 50 * s, ny + 55 * s); g.lineTo(-nw / 2 + 44 * s, ny + 46 * s); g.closePath(); g.fill();
    g.restore();
    text('TELEGRAM', -nw / 2 + 80 * s, ny + 38 * s, 17 * s, 600, 'rgba(203,213,225,.85)', { alpha: k, font: MONO, spacing: 1 });
    text('now', nw / 2 - 22 * s, ny + 38 * s, 18 * s, 400, 'rgba(148,163,184,.9)', { align: 'right', alpha: k });
    wrapped.forEach(([l, j], r) => text(l, -nw / 2 + 26 * s, ny + (86 + r * 30) * s, (j ? 23 : 25) * s, j ? 400 : 600, j ? 'rgba(226,232,240,.92)' : '#fff', { alpha: k, font: `${SANS}, ${EMOJI}` }));
  });
  g.restore();
  rr(-60 * s, -h / 2 + 18 * s, 120 * s, 34 * s, 17 * s); g.fillStyle = '#000'; g.fill();
  g.restore();
}
function sceneAlerts(t) {
  bg(t + 45, '#04050c', '#140b1c');
  const danger = clamp((t - 3.6) / 0.4) * (1 - clamp((t - 12.5) / 1.0));
  glow(W * 0.6, H * 0.45, 900, 'rgba(244,63,94,.16)', danger);
  particles(t + 45, 0.22, danger > 0.2 ? '255,170,190' : '190,230,255');
  // a) The real temperature chart; a playhead runs to the breach.
  if (t < 7.2) {
    const k = win(t, 0, 7.2, 0.7, 0.6);
    const cw = 1006, ch = 130, scale = 1.72, w = cw * scale, h = ch * scale, x0 = (W - w) / 2, y0 = 330;
    g.save(); g.globalAlpha = k; g.shadowColor = 'rgba(56,189,248,.3)'; g.shadowBlur = 60; rr(x0 - 20, y0 - 20, w + 40, h + 40, 22); g.fillStyle = '#0d1117'; g.fill(); g.restore();
    g.save(); g.globalAlpha = k; g.drawImage(A.tempRow, x0, y0, w, h); g.restore();
    // The alert limit (8 °C) is the dashed line in the real chart, at y 551 of the frame.
    const limY = y0 + (551 - 470) * scale;
    const lk = out((t - 1.0) / 0.6) * k;
    g.save(); g.globalAlpha = lk; g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(244,63,94,.85)'; g.lineWidth = 3; g.shadowColor = WARN; g.shadowBlur = 20; g.setLineDash([14, 10]); g.beginPath(); g.moveTo(x0 + (322 - 257) * scale, limY); g.lineTo(x0 + (1230 - 257) * scale, limY); g.stroke(); g.restore();
    text('ALERT LIMIT · 8 °C', x0 + w - 10, limY - 16, 18, 600, '#fda4af', { align: 'right', alpha: lk, font: MONO, spacing: 2 });
    const hx0 = x0 + (322 - 257) * scale, hx1 = x0 + (978 - 257) * scale, p = ease((t - 1.4) / 2.4), hx = lerp(hx0, hx1, p);
    if (t > 1.4) {
      g.save(); g.globalAlpha = k; g.strokeStyle = 'rgba(165,243,252,.9)'; g.lineWidth = 2; g.shadowColor = ACC2; g.shadowBlur = 16; g.beginPath(); g.moveTo(hx, y0 - 10); g.lineTo(hx, y0 + h + 10); g.stroke(); g.restore();
    }
    if (t > 3.8) {
      const sy = y0 + (536 - 470) * scale, pk = (t - 3.8);
      for (let r = 0; r < 3; r++) { const q = ((pk * 0.9 + r / 3) % 1); g.save(); g.globalAlpha = k * (1 - q); g.strokeStyle = WARN; g.lineWidth = 3; g.beginPath(); g.arc(hx1, sy, 14 + q * 70, 0, 7); g.stroke(); g.restore(); }
      glow(hx1, sy, 90, 'rgba(244,63,94,.7)', k);
      const lk2 = out((t - 4.0) / 0.5) * k;
      g.save(); g.globalAlpha = lk2; rr(hx1 + 40, sy - 130, 430, 104, 18); g.fillStyle = 'rgba(76,5,25,.92)'; g.fill(); g.strokeStyle = 'rgba(251,113,133,.8)'; g.lineWidth = 1.5; g.stroke(); g.restore();
      text('8.1 °C  >  8 °C limit', hx1 + 66, sy - 82, 32, 600, '#fff', { alpha: lk2, font: MONO });
      text('Fridge door left open · 7:21 PM', hx1 + 66, sy - 44, 22, 400, '#fecdd3', { alpha: lk2 });
    }
    title(t, 0.6, 7.0, 'SMART MONITORING', 'Every reading checked against your limits.', null, { x: 120, y: 900 });
  }
  // b) The alert reaches the phone (the same text the server sends to Telegram).
  if (t > 6.6 && t < 13.4) {
    const k = win(t, 6.6, 13.4, 0.7, 0.6);
    phoneMock(1290, 540 + (1 - outQ((t - 6.6) / 1.2)) * 80, 0.98, k, t, [{ at: 7.9, lines: NOTE1 }]);
    text('INSTANT ALERTS', 140, 380, 22, 600, ACC2, { alpha: k * out((t - 7.0) / 0.7), font: MONO, spacing: 5 });
    text('The moment a limit', 140, 470, 70, 600, '#fff', { alpha: k * out((t - 7.2) / 0.8), blur: (1 - out((t - 7.2) / 0.8)) * 8 });
    text('is crossed.', 140, 552, 70, 600, '#fda4af', { alpha: k * out((t - 7.5) / 0.8), blur: (1 - out((t - 7.5) / 0.8)) * 8 });
    text('Telegram and ntfy push notifications', 142, 630, 28, 400, '#cbd5e1', { alpha: k * out((t - 8.2) / 0.8) });
    text('— and a red dashboard.', 142, 672, 28, 400, '#cbd5e1', { alpha: k * out((t - 8.5) / 0.8) });
  }
  // c) Every breach is logged (the real Alerts page), then back to safe.
  if (t > 12.8) {
    const k = win(t, 12.8, 20, 0.7, 0.8), p = outQ((t - 12.8) / 2.2);
    const o = { w: 1920 * 0.66, h: 1080 * 0.66, x: lerp(-520, -360, p), y: -20, z: lerp(-800, -200, p), ry: lerp(-26, -16, p), rx: 3, alpha: k, radius: 18 };
    const pts = plane(A.alerts, o);
    // Highlight the logged alert row (frame y 258–330).
    if (pts && t > 14.0) {
      const m = planeMatrix(o), fxy = (fx, fy) => project(m, fx / 960 - 1, 1 - fy / 540);
      const q = [fxy(258, 258), fxy(1774, 258), fxy(1774, 330), fxy(258, 330)], hk = out((t - 14) / 0.5) * k * (0.75 + 0.25 * Math.sin(t * 6));
      g.save(); g.globalAlpha = hk; g.strokeStyle = WARN; g.lineWidth = 3; g.shadowColor = WARN; g.shadowBlur = 24; g.beginPath(); q.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); g.restore();
    }
    phoneMock(1460, 560 + (1 - outQ((t - 15.6) / 1.0)) * 60, 0.82, k * out((t - 15.6) / 0.8), t, [{ at: 15.8, lines: NOTE1 }, { at: 16.9, lines: NOTE2 }]);
    title(t, 13.2, 19.8, 'LOGGED & RESOLVED', 'Every breach on record.', 'And a message when it is back to normal', { x: 120, y: 990 });
  }
  badge(win(t, 0.5, 20, 1, 0.6));
}

// 5 — Brand reveal (65–80 s)
function sceneReveal(t) {
  bg(t + 65, '#03050b', '#081226'); particles(t + 65, 0.5, '190,230,255', 1.6);
  // a) A slow carousel of the real screens.
  if (t < 6.2) {
    const k = win(t, 0, 6.2, 0.7, 0.8), spin = t * 6;
    const items = [[A.arabic, 1920 * 0.5, 1080 * 0.5, -40], [A.dash, 1920 * 0.55, 1080 * 0.55, 0], [A.phone2, 390 * 1.15, 844 * 1.15, 40]];
    items.forEach(([src, w, h, ang], i) => {
      const a = deg(ang + spin - 6), x = Math.sin(a) * 760, z = Math.cos(a) * 520 - 900 - t * 70;
      plane(src, { w, h, x, y: -30 + (i === 2 ? 20 : 0), z, ry: -(ang + spin - 6) * 0.9, alpha: k * (i === 1 ? 1 : 0.9), radius: i === 2 ? 34 : 18, bright: 0.95 });
    });
    text('ARABIC · ENGLISH · MALAY · DARK MODE · PHONE', W / 2, 930, 24, 600, '#cbd5e1', { align: 'center', alpha: k * out((t - 0.8) / 0.8), font: MONO, spacing: 6 });
  }
  // b) Final reveal.
  if (t > 6.0) {
    const k = out((t - 6.2) / 1.0), end = 1 - clamp((t - 13.6) / 1.4);
    const fl = (t > 6.0 && t < 6.6) ? 1 - (t - 6.0) / 0.6 : 0;
    glow(W / 2, 430, 760, 'rgba(37,99,235,.38)', k * end);
    // light rays
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.12 * k * end;
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + t * 0.05; g.fillStyle = 'rgba(147,197,253,1)'; g.beginPath(); g.moveTo(W / 2, 400); g.lineTo(W / 2 + Math.cos(a) * 1400, 400 + Math.sin(a) * 1400); g.lineTo(W / 2 + Math.cos(a + 0.06) * 1400, 400 + Math.sin(a + 0.06) * 1400); g.closePath(); g.fill(); }
    g.restore();
    g.save(); g.globalAlpha = k * end; g.translate(W / 2, 330); const s = lerp(1.3, 1, outQ((t - 6.2) / 1.8)); g.scale(s, s); g.shadowColor = 'rgba(56,189,248,.8)'; g.shadowBlur = 60; g.drawImage(A.logo, -70, -70, 140, 140); g.restore();
    text('Kelvin', W / 2, 560, 170, 700, '#fff', { align: 'center', alpha: k * end, spacing: lerp(30, -3, outQ((t - 6.2) / 2)) });
    text('Know before it spoils.', W / 2, 650, 52, 300, '#e0f2fe', { align: 'center', alpha: out((t - 7.4) / 1.0) * end, blur: (1 - out((t - 7.4) / 0.9)) * 8 });
    text('Smart fridge monitoring · ESP32 · DHT11 · CCS811', W / 2, 720, 26, 400, '#94a3b8', { align: 'center', alpha: out((t - 8.2) / 1.0) * end });
    const uk = out((t - 9.0) / 0.9) * end;
    g.save(); g.globalAlpha = uk; g.font = `600 30px ${MONO}`; const uw = g.measureText('kelvin-smart-fridge.vercel.app').width + 60; rr(W / 2 - uw / 2, 776, uw, 62, 31); g.fillStyle = 'rgba(14,165,233,.14)'; g.fill(); g.strokeStyle = 'rgba(125,211,252,.6)'; g.lineWidth = 1.5; g.stroke(); g.restore();
    text('kelvin-smart-fridge.vercel.app', W / 2, 818, 30, 600, '#e0f2fe', { align: 'center', alpha: uk, font: MONO });
    text('ALSARRAY ALI AHMED ALI  ·  Universiti Sains Malaysia', W / 2, 920, 24, 500, '#cbd5e1', { align: 'center', alpha: out((t - 9.8) / 1.0) * end, spacing: 2 });
    if (fl > 0) { g.fillStyle = `rgba(230,242,255,${fl * 0.6})`; g.fillRect(0, 0, W, H); }
  }
}

// ---------- Timeline ----------
const SCENES = [[0, 11, sceneHook], [11, 25, sceneTech], [25, 45, sceneApp], [45, 65, sceneAlerts], [65, 80, sceneReveal]];
function render(T) {
  T = clamp(T, 0, TOTAL);
  g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = 1; g.filter = 'none';
  const i = SCENES.findIndex(([a, b]) => T >= a && T < b);
  const [a, , fn] = SCENES[i < 0 ? SCENES.length - 1 : i];
  fn(T - a);
  // Short dip-to-black between scenes.
  for (const [s] of SCENES.slice(1)) { const d = Math.abs(T - s); if (d < 0.45) { g.fillStyle = `rgba(0,0,0,${(1 - d / 0.45) * 0.85})`; g.fillRect(0, 0, W, H); } }
  finish(T);
  if (T > TOTAL - 1.0) { g.fillStyle = `rgba(0,0,0,${clamp((T - (TOTAL - 1.0)) / 1.0)})`; g.fillRect(0, 0, W, H); }
}


// ---------- Setup (once per browser tab) ----------
export const DURATION = TOTAL, WIDTH = W, HEIGHT = H, RATE = FPS;
let ready = null;
export function setup(url) {
  ready ??= (async () => {
    const [logo, fridge, ...frames] = await Promise.all([loadImg(url('logo.svg')), loadImg(url('fridge.png')), ...Object.values(FR).map(f => loadImg(url('frames/' + f)))]);
    const F = Object.fromEntries(Object.keys(FR).map((k, i) => [k, frames[i]]));
    A.logo = logo; A.fridge = keyWhite(fridge);
    Object.assign(A, F);
    A.temp = crop(F.dash, 257, 182, 366, 169); A.hum = crop(F.dash, 641, 182, 366, 169); A.eco2 = crop(F.dash, 1025, 182, 366, 169); A.tvoc = crop(F.dash, 1409, 182, 366, 169);
    A.chart = crop(F.dash, 257, 369, 1006, 371); A.tempRow = crop(F.dash, 257, 470, 1006, 130);
    grainCanvas = document.createElement('canvas'); grainCanvas.width = grainCanvas.height = 256;
    const gx = grainCanvas.getContext('2d'), id = gx.createImageData(256, 256);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // same grain in every tab
    for (let i = 0; i < id.data.length; i += 4) { const v = rnd() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    gx.putImageData(id, 0, 0);
    for (const w of [300, 400, 500, 600, 700]) await document.fonts.load(`${w} 40px "IBM Plex Sans"`);
    await document.fonts.load('500 20px "IBM Plex Mono"'); await document.fonts.load('600 20px "IBM Plex Mono"');
    for (const k of ['dash', 'arabic', 'energy', 'alerts', 'phone', 'phone2', 'temp', 'hum', 'eco2', 'tvoc', 'chart']) tex(A[k]);
  })();
  return ready;
}
/** Draws the frame at time T (seconds) and returns the 1920×1080 canvas. */
export function drawFrame(T) { render(T); return c; }
