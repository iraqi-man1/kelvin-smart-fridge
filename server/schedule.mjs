/**
 * The fixed reading schedule: one saved reading every 90 minutes, on the same clock times
 * every day (00:00, 01:30, 03:00 … 22:30 in KELVIN_TIMEZONE). Nobody can change it from the
 * dashboard or the device: the device checks in often, and the server keeps only the first
 * reading of each 90-minute slot.
 */
export const READING_EVERY = 90 * 60000;
const TZ = process.env.KELVIN_TIMEZONE || 'Asia/Kuala_Lumpur';

/** The time zone's offset from UTC at that moment, in ms (Baghdad +3 h = 10 800 000). */
function offsetAt(ts, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(ts).map(p => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return local - Math.floor(ts / 1000) * 1000;
}

/** When the slot holding `ts` began (a multiple of 90 minutes from local midnight). */
export function slotStart(ts, timeZone = TZ) {
  const offset = offsetAt(ts, timeZone);
  return Math.floor((ts + offset) / READING_EVERY) * READING_EVERY - offset;
}

/** Whether a reading at `ts` is due, given the last saved one. */
export const isDue = (ts, last, timeZone = TZ) => !last || slotStart(ts, timeZone) !== slotStart(last, timeZone);

/** When the next reading will be kept. */
export const nextSlot = (ts, timeZone = TZ) => slotStart(ts, timeZone) + READING_EVERY;
