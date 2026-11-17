import { randomUUID } from 'node:crypto';

/**
 * IT support: anyone signed in can report a fault or a problem. Each report goes to the IT
 * team's own Telegram bot (separate from the fridge alerts bot) and is kept in the store
 * (setting support_tickets), so the sender and the admins can see what was sent.
 *
 * The bot is set by an admin on the IT support page, or with IT_BOT_TOKEN / IT_CHAT_ID.
 * The token never goes back to the browser.
 */
export const CATEGORIES = ['fault', 'problem', 'account', 'question'];
const KEEP = 200;
const PER_HOUR = 5;
const HOUR = 3600000;

const TEXT = {
  ar: {
    title: '🛠 بلاغ جديد للدعم الفني — Kelvin', kind: 'النوع', from: 'من', role: 'الصلاحية', message: 'الرسالة', at: 'الوقت', id: 'رقم البلاغ',
    cats: { fault: 'عطل', problem: 'مشكلة', account: 'حساب ودخول', question: 'سؤال' },
    roles: { admin: 'مدير', member: 'مشغّل', viewer: 'مشاهد' },
    test: '✅ بوت الدعم الفني في Kelvin مربوط ويعمل.',
  },
  en: {
    title: '🛠 New IT support report — Kelvin', kind: 'Type', from: 'From', role: 'Role', message: 'Message', at: 'Time', id: 'Report',
    cats: { fault: 'Fault', problem: 'Problem', account: 'Account and sign-in', question: 'Question' },
    roles: { admin: 'Admin', member: 'Operator', viewer: 'Viewer' },
    test: '✅ The Kelvin IT support bot is linked and working.',
  },
  ms: {
    title: '🛠 Laporan sokongan IT baharu — Kelvin', kind: 'Jenis', from: 'Daripada', role: 'Peranan', message: 'Mesej', at: 'Masa', id: 'Laporan',
    cats: { fault: 'Kerosakan', problem: 'Masalah', account: 'Akaun dan log masuk', question: 'Soalan' },
    roles: { admin: 'Pentadbir', member: 'Pengendali', viewer: 'Penonton' },
    test: '✅ Bot sokongan IT Kelvin telah disambung dan berfungsi.',
  },
};

export class SupportError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function createSupport({ store, env = process.env, fetchImpl = fetch, now = Date.now }) {
  const loadConfig = async () => ({ enabled: true, token: '', chatId: '', lang: 'ar', ...((await store.getSetting('it_support')) ?? {}) });
  const loadTickets = async () => (await store.getSetting('support_tickets')) ?? [];
  const creds = c => ({ token: env.IT_BOT_TOKEN || c.token, chatId: env.IT_CHAT_ID || c.chatId });

  async function telegram(token, chatId, text) {
    let res;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch { throw new SupportError('support-send-failed', 502); }
    if (!res.ok) throw new SupportError('support-send-failed', 502);
  }

  const publicTicket = ({ email, ...t }) => t;

  return {
    /** For the admin: is the bot linked (the token itself is never returned). */
    async getPublic() {
      const c = await loadConfig();
      const { token, chatId } = creds(c);
      return { enabled: c.enabled !== false, configured: Boolean(token && chatId), chatId: c.chatId, fromEnv: Boolean(env.IT_BOT_TOKEN), lang: c.lang };
    },

    async update(input) {
      const c = await loadConfig();
      const next = { ...c };
      if (typeof input?.enabled === 'boolean') next.enabled = input.enabled;
      if (typeof input?.token === 'string' && input.token.trim()) {
        if (!/^\d{5,}:[\w-]{20,}$/.test(input.token.trim())) throw new SupportError('bad-token');
        next.token = input.token.trim();
      }
      if (typeof input?.chatId === 'string') {
        const id = input.chatId.trim();
        if (id && !/^(-?\d{3,20}|@[A-Za-z][\w]{3,})$/.test(id)) throw new SupportError('bad-chat');
        next.chatId = id;
      }
      if (['ar', 'en', 'ms'].includes(input?.lang)) next.lang = input.lang;
      await store.setSetting('it_support', next);
      return this.getPublic();
    },

    async test() {
      const c = await loadConfig();
      const { token, chatId } = creds(c);
      if (!token || !chatId) throw new SupportError('support-not-configured', 503);
      await telegram(token, chatId, (TEXT[c.lang] || TEXT.ar).test);
    },

    /** A report from a signed-in user. Up to 5 an hour per person. */
    async report(user, input) {
      const category = CATEGORIES.includes(input?.category) ? input.category : 'problem';
      const message = typeof input?.message === 'string' ? input.message.trim() : '';
      if (message.length < 5) throw new SupportError('support-too-short');
      if (message.length > 1000) throw new SupportError('support-too-long');
      const c = await loadConfig();
      const { token, chatId } = creds(c);
      if (c.enabled === false || !token || !chatId) throw new SupportError('support-not-configured', 503);
      const tickets = await loadTickets();
      const t = now();
      if (tickets.filter(x => x.userId === user.id && t - x.at < HOUR).length >= PER_HOUR) throw new SupportError('support-too-many', 429);

      const ticket = { id: randomUUID().slice(0, 6).toUpperCase(), userId: user.id, name: user.name, email: user.email, role: user.role, category, message, at: t };
      const L = TEXT[c.lang] || TEXT.ar;
      const when = new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      await telegram(token, chatId, [
        L.title, '',
        `${L.kind}: ${L.cats[category]}`,
        `${L.from}: ${user.name} <${user.email}>`,
        `${L.role}: ${L.roles[user.role] ?? user.role}`,
        `${L.at}: ${when}`,
        `${L.id}: #${ticket.id}`, '',
        `${L.message}:`, message,
      ].join('\n'));
      await store.setSetting('support_tickets', [...tickets, ticket].slice(-KEEP));
      return publicTicket(ticket);
    },

    /** The sender sees their own reports; an admin sees everyone's. */
    async list(user, all = false) {
      const tickets = await loadTickets();
      return tickets.filter(x => all || x.userId === user.id).slice(-50).reverse().map(x => all ? x : publicTicket(x));
    },

    async countFor(userId) { return (await loadTickets()).filter(x => x.userId === userId).length; },
  };
}
