import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReading } from '../server/readings.mjs';

const valid = { temperature: 26.43, humidity: 58.27, eco2: 612.4, tvoc: 37, deviceId: 'ESP32-WROOM-32' };
test('keeps DHT11 and CCS811 values and stamps server reception time', () => {
  const reading = normalizeReading(valid, 123456);
  assert.equal(reading.eco2, 612);
  assert.equal(reading.tvoc, 37);
  assert.equal(reading.temperature, 26.4);
  assert.equal(reading.humidity, 58.3);
  assert.equal(reading.timestamp, 123456);
  assert.equal(reading.deviceId, valid.deviceId);
  assert.ok(reading.id);
});
test('rejects invalid sensor readings rather than accepting misleading values', () => {
  for (const change of [{ humidity: 101 }, { humidity: -1 }, { temperature: null }, { eco2: '600' }, { eco2: -1 }, { tvoc: NaN }, { tvoc: undefined }, { rssi: 10 }, { deviceId: '<script>' }]) {
    assert.throws(() => normalizeReading({ ...valid, ...change }));
  }
  assert.throws(() => normalizeReading(null));
});
test('accepts valid edge values and optional telemetry', () => {
  const r = normalizeReading({ ...valid, temperature: -40, humidity: 0, rssi: -65, uptime: 120 });
  assert.equal(r.temperature, -40);
  assert.equal(r.humidity, 0);
  assert.equal(r.rssi, -65);
  assert.equal(r.uptime, 120);
});
