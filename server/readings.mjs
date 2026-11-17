const finite = v => typeof v === 'number' && Number.isFinite(v);

// DHT11: temperature and humidity. CCS811: eCO2 in ppm and TVOC in ppb.
const FIELDS = [
  ['temperature', -40, 125, 1],
  ['humidity', 0, 100, 1],
  ['eco2', 0, 65535, 0],
  ['tvoc', 0, 65535, 0],
];

export function normalizeReading(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A JSON object is required.');
  const values = {};
  for (const [name, min, max, digits] of FIELDS) {
    if (!finite(body[name]) || body[name] < min || body[name] > max) {
      throw new Error(`${name} must be a finite number between ${min} and ${max}. eco2 is in ppm and tvoc in ppb.`);
    }
    values[name] = +body[name].toFixed(digits);
  }
  if (body.deviceId !== undefined && (typeof body.deviceId !== 'string' || !/^[\w .:-]{1,64}$/.test(body.deviceId))) throw new Error('Invalid deviceId.');
  if (body.rssi !== undefined && (!finite(body.rssi) || body.rssi < -127 || body.rssi > 0)) throw new Error('rssi must be between -127 and 0.');
  if (body.uptime !== undefined && (!finite(body.uptime) || body.uptime < 0)) throw new Error('Invalid uptime.');
  return {
    id: crypto.randomUUID(), timestamp: now, ...values,
    deviceId: body.deviceId || 'ESP32-WROOM-32',
    ...(body.rssi !== undefined ? { rssi: body.rssi } : {}),
    ...(body.uptime !== undefined ? { uptime: body.uptime } : {}),
  };
}
