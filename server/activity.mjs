/**
 * How each person uses Kelvin, for the badges on the account page: the days they opened it,
 * sign-ins, Excel exports, device commands and IT reports. Kept in the store (setting
 * activity) and counted on the server, so badges cannot be given to yourself from the browser.
 */
const EVENTS = ['login', 'export', 'command', 'report'];
const KEEP_DAYS = 400;
const DAY = 86400000;

const dayOf = t => new Date(t).toISOString().slice(0, 10);

export function createActivity({ store, now = Date.now }) {
  const load = async () => (await store.getSetting('activity')) ?? {};
  const blank = () => ({ days: [], login: 0, export: 0, command: 0, report: 0 });

  async function update(userId, change) {
    const all = await load();
    const entry = { ...blank(), ...(all[userId] ?? {}) };
    if (!change(entry)) return entry;
    all[userId] = entry;
    await store.setSetting('activity', all);
    return entry;
  }
  const markToday = entry => {
    const today = dayOf(now());
    if (entry.days.at(-1) === today) return false;
    entry.days = [...entry.days, today].slice(-KEEP_DAYS);
    return true;
  };

  return {
    /** Opening the app: today counts as an active day (written once a day). */
    seen(userId) { return update(userId, markToday); },

    /** An action worth a badge. Only known events are counted. */
    record(userId, event) {
      if (!EVENTS.includes(event)) return Promise.resolve(null);
      return update(userId, entry => { markToday(entry); entry[event] = (entry[event] ?? 0) + 1; return true; });
    },

    async forget(userId) {
      const all = await load();
      if (!(userId in all)) return;
      delete all[userId];
      await store.setSetting('activity', all);
    },

    /** Numbers for the account page. */
    async stats(user) {
      const entry = { ...blank(), ...((await load())[user.id] ?? {}) };
      const days = [...new Set(entry.days)].sort();
      // Streaks of consecutive days; the current one still counts if the last day was yesterday.
      let best = 0, run = 0, prev = null;
      for (const d of days) {
        const t = Date.parse(d);
        run = prev !== null && t - prev === DAY ? run + 1 : 1;
        best = Math.max(best, run);
        prev = t;
      }
      const today = Date.parse(dayOf(now()));
      const current = prev !== null && today - prev <= DAY ? run : 0;
      return {
        memberDays: Math.max(1, Math.floor((now() - user.createdAt) / DAY) + 1),
        activeDays: days.length, streak: current, bestStreak: best,
        logins: entry.login, exports: entry.export, commands: entry.command, reports: entry.report,
        firstDay: days[0] ?? null,
      };
    },
  };
}
