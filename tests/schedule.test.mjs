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

test('slots are one minute long, from the start of each local minute', () => {
  // Baghdad is UTC+3: 10:40:25 local is in the 10:40 slot; the next starts at 10:41.
  assert.equal(slotStart(at('2026-11-27T07:40:25Z'), 'Asia/Baghdad'), at('2026-11-27T07:40:00Z'));
  assert.equal(nextSlot(at('2026-11-27T07:40:25Z'), 'Asia/Baghdad'), at('2026-11-27T07:41:00Z'));
  // Kuala Lumpur (UTC+8): local midnight starts a slot.
  assert.equal(slotStart(at('2026-11-27T16:00:59Z'), 'Asia/Kuala_Lumpur'), at('2026-11-27T16:00:00Z'));
  // 1,440 slots a day: about 43,000 requests a month, well inside the free hosting plan.
  assert.equal(86400000 / READING_EVERY, 1440);
});

test('only the first reading of each slot is due', () => {
  const tz = 'Asia/Baghdad';
  assert.equal(isDue(at('2026-11-27T07:31:02Z'), undefined, tz), true);
  assert.equal(isDue(at('2026-11-27T07:31:59Z'), at('2026-11-27T07:31:02Z'), tz), false);
  assert.equal(isDue(at('2026-11-27T07:32:01Z'), at('2026-11-27T07:31:02Z'), tz), true);
});

test('the dashboard has no device commands any more', async () => {
  const device = createDevice({ store: createJsonStore(path.join(tmpdir(), `kelvin-sched-${Math.random()}`)) });
  assert.equal(device.add, undefined);
  assert.equal('commands' in (await device.status()), false);
});

test('the server keeps one reading per slot; a second send in the same slot is not saved', async () => {
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
    assert.ok(a.nextIn > 0 && a.nextIn <= 60);
    const second = await post();
    assert.equal(second.status, 200);
    const b = await second.json();
    assert.equal(b.saved, false);
    assert.equal(b.reading, undefined);
    assert.equal(b.commands, undefined);
    assert.ok(b.nextIn > 0 && b.nextIn <= 60);
  } finally {
    server.close();
    await app.close();
  }
});
