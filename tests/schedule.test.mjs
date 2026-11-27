import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.mjs';
import { createDevice } from '../server/device.mjs';
import { createJsonStore } from '../server/store.mjs';
import { isDue, nextSlot, READING_EVERY, slotStart } from '../server/schedule.mjs';

const at = iso => Date.parse(iso);

test('slots are 90 minutes from local midnight, in the chosen time zone', () => {
  // Baghdad is UTC+3: 10:40 local (07:40 UTC) is in the 10:30–12:00 slot.
  assert.equal(slotStart(at('2026-11-27T07:40:00Z'), 'Asia/Baghdad'), at('2026-11-27T07:30:00Z'));
  assert.equal(nextSlot(at('2026-11-27T07:40:00Z'), 'Asia/Baghdad'), at('2026-11-27T09:00:00Z'));
  // Kuala Lumpur is UTC+8: local midnight 16:00 UTC starts a slot; 01:29 local is still in it.
  assert.equal(slotStart(at('2026-11-27T17:29:00Z'), 'Asia/Kuala_Lumpur'), at('2026-11-27T16:00:00Z'));
  assert.equal(slotStart(at('2026-11-27T17:30:00Z'), 'Asia/Kuala_Lumpur'), at('2026-11-27T17:30:00Z'));
  // 16 slots a day.
  assert.equal(86400000 / READING_EVERY, 16);
});

test('only the first reading of each slot is due', () => {
  const tz = 'Asia/Baghdad';
  assert.equal(isDue(at('2026-11-27T07:31:00Z'), undefined, tz), true);
  assert.equal(isDue(at('2026-11-27T08:59:59Z'), at('2026-11-27T07:31:00Z'), tz), false);
  assert.equal(isDue(at('2026-11-27T09:00:05Z'), at('2026-11-27T07:31:00Z'), tz), true);
});

test('the send rate is not a device command any more', async () => {
  const device = createDevice({ store: createJsonStore(path.join(tmpdir(), `kelvin-sched-${Math.random()}`)) });
  await assert.rejects(device.add('interval', 5, 'Ali'), { code: 'bad-command' });
});

test('the server keeps one reading per slot; check-ins in between still get commands', async () => {
  const dir = path.join(tmpdir(), `kelvin-sched-app-${Math.random()}`);
  const app = await createApp({ dataDir: dir, readingsFile: path.join(dir, 'readings.json'), log: () => {} });
  const server = createServer(async (req, res) => { if (!(await app.handle(req, res))) { res.statusCode = 404; res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = () => fetch(`${base}/api/readings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ temperature: 4, humidity: 50, eco2: 500, tvoc: 10 }) });
  try {
    const first = await post();
    assert.equal(first.status, 201);
    const a = await first.json();
    assert.equal(a.saved, true);
    assert.ok(a.nextIn > 0 && a.nextIn <= 5400);
    const second = await post();
    assert.equal(second.status, 200);
    const b = await second.json();
    assert.equal(b.saved, false);
    assert.equal(b.reading, undefined);
    assert.ok(Array.isArray(b.commands));
  } finally {
    server.close();
    await app.close();
  }
});
