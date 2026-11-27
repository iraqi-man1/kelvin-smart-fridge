// Sample fridge data for the demo video: 7 days, the last 26 hours one reading a minute
// (like the real schedule), older days thinner (the local JSON store keeps 2,000 readings).
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });
const MIN = 60000, now = Math.floor(Date.now() / MIN) * MIN - MIN;
const recent = 26 * 60, older = 2000 - recent;
const start = now - 7 * 86400000;
const times = [];
for (let i = 0; i < older; i++) times.push(Math.round((start + i * ((now - recent * MIN - start) / older)) / MIN) * MIN);
for (let i = recent; i >= 1; i--) times.push(now - (i - 1) * MIN);
const boot = now - 3 * 86400000 - 4 * 3600000 - 17 * MIN; // the ESP32 was switched on 3 days ago

// Door openings: a quick warm-up then the fridge pulls back down (minutes after each start).
const doors = [now - 5.8 * 86400000, now - 4.3 * 86400000, now - 2.6 * 86400000, now - 1.4 * 86400000, now - 26 * 3600000 + 40 * MIN, now - 7 * 3600000, now - 2.2 * 3600000];
const noise = t => Math.sin(t / 7.3e5) * 0.18 + Math.sin(t / 2.9e6 + 1) * 0.12;
const out = times.map((t, i) => {
  const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  // Compressor cycles (about 40 minutes), a little warmer in the afternoon.
  let temp = 4.1 + 0.55 * Math.sin(t / (40 * MIN / (2 * Math.PI))) + 0.35 * Math.sin((hour - 9) / 24 * 2 * Math.PI) + noise(t);
  let hum = 64 + 4 * Math.sin(t / (55 * MIN / (2 * Math.PI)) + 2) + 2 * Math.sin(hour / 24 * 2 * Math.PI);
  let eco2 = 470 + 60 * Math.sin(t / (3.1 * 3600000) + 0.5) + 25 * Math.sin(t / (47 * MIN));
  let tvoc = 18 + 9 * Math.sin(t / (2.7 * 3600000) + 1.3) + 3 * Math.sin(t / (31 * MIN));
  for (const d of doors) {
    const m = (t - d) / MIN;
    if (m >= 0 && m < 45) {
      const k = m < 4 ? m / 4 : Math.exp(-(m - 4) / 9);
      temp += 6.8 * k; hum += 14 * k; eco2 += 380 * k; tvoc += 55 * k;
    }
  }
  return {
    id: `seed-${i}`, timestamp: t,
    temperature: +temp.toFixed(1), humidity: +Math.min(99, hum).toFixed(1), eco2: Math.round(eco2), tvoc: Math.round(tvoc),
    deviceId: 'ESP32-WROOM-32', rssi: -52 - Math.round(4 * Math.abs(Math.sin(t / 3.3e6))), uptime: Math.round((t - (t >= boot ? boot : boot - 6 * 86400000)) / 1000),
  };
});
fs.writeFileSync(path.join(dir, 'readings.json'), JSON.stringify(out));
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ boot, now, count: out.length }));
console.log('readings', out.length, 'from', new Date(out[0].timestamp).toISOString(), 'to', new Date(out.at(-1).timestamp).toISOString());
