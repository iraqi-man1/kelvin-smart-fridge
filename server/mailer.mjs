/**
 * Sends the sign-in code emails.
 *
 * Settings (in .env):
 *   Gmail:      GMAIL_USER=you@gmail.com  GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 *   Any SMTP:   SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS, optional SMTP_FROM
 * Without them `configured` is false, and two-step sign-in cannot be turned on.
 */
export function createMailer(env = process.env, { transport } = {}) {
  const gmail = env.GMAIL_USER && env.GMAIL_APP_PASSWORD;
  const smtp = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS;
  const configured = Boolean(transport || gmail || smtp);
  const from = env.SMTP_FROM || `Kelvin <${env.GMAIL_USER || env.SMTP_USER || 'kelvin@localhost'}>`;
  let sender = transport;

  async function getSender() {
    if (sender) return sender;
    const { default: nodemailer } = await import('nodemailer');
    sender = gmail
      ? nodemailer.createTransport({ service: 'gmail', auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') } })
      : nodemailer.createTransport({
        host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 465, secure: (Number(env.SMTP_PORT) || 465) === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
    return sender;
  }

  return {
    configured,
    async send(message) {
      if (!configured) throw Object.assign(new Error('email-not-configured'), { code: 'email-not-configured' });
      await (await getSender()).sendMail({ from, ...message });
    },
  };
}

const TEXT = {
  ar: {
    dir: 'rtl',
    subject: { login: 'رمز تسجيل الدخول إلى Kelvin', enable: 'تأكيد بريدك في Kelvin', reset: 'إعادة تعيين كلمة السر في Kelvin' },
    intro: { login: 'هذا رمز تسجيل الدخول إلى لوحة Kelvin:', enable: 'هذا رمز تفعيل التحقق بخطوتين في Kelvin:', reset: 'هذا رمز إعادة تعيين كلمة سر حسابك في Kelvin:' },
    expires: 'ينتهي خلال 10 دقائق.',
    ignore: 'إذا لم تطلب هذا الرمز فتجاهل الرسالة، ولا تعطه لأي شخص.',
  },
  en: {
    dir: 'ltr',
    subject: { login: 'Your Kelvin sign-in code', enable: 'Confirm your email for Kelvin', reset: 'Reset your Kelvin password' },
    intro: { login: 'Here is your code to sign in to the Kelvin dashboard:', enable: 'Here is your code to turn on two-step sign-in in Kelvin:', reset: 'Here is your code to reset your Kelvin password:' },
    expires: 'It expires in 10 minutes.',
    ignore: 'If you did not ask for this code, ignore this email and do not share the code with anyone.',
  },
  ms: {
    dir: 'ltr',
    subject: { login: 'Kod log masuk Kelvin anda', enable: 'Sahkan e-mel anda untuk Kelvin', reset: 'Tetapkan semula kata laluan Kelvin anda' },
    intro: { login: 'Ini kod untuk log masuk ke papan pemuka Kelvin:', enable: 'Ini kod untuk menghidupkan log masuk dua langkah dalam Kelvin:', reset: 'Ini kod untuk menetapkan semula kata laluan Kelvin anda:' },
    expires: 'Ia tamat tempoh dalam 10 minit.',
    ignore: 'Jika anda tidak meminta kod ini, abaikan e-mel ini dan jangan kongsi kod ini dengan sesiapa.',
  },
};

/** The email for a code, in the user's language: plain text plus a simple HTML version. */
export function codeEmail({ code, purpose, lang, name }) {
  const t = TEXT[lang] || TEXT.ar;
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = `${name ? name + '\n\n' : ''}${t.intro[purpose]}\n\n${spaced}\n\n${t.expires}\n${t.ignore}\n\nKelvin`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f2f4;font-family:Segoe UI,Tahoma,Arial,sans-serif">
<div dir="${t.dir}" style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #e2e5e9;border-radius:12px;padding:28px;color:#161b22">
<p style="margin:0 0 4px;font-weight:700;font-size:16px">Kelvin</p>
<p style="margin:0 0 18px;color:#454d5a;font-size:14px;line-height:1.6">${t.intro[purpose]}</p>
<p dir="ltr" style="margin:0 0 18px;padding:14px;border-radius:10px;background:#e9eef5;color:#1f3b63;font:700 30px/1 Consolas,monospace;letter-spacing:6px;text-align:center">${spaced}</p>
<p style="margin:0 0 6px;color:#454d5a;font-size:13px">${t.expires}</p>
<p style="margin:0;color:#697281;font-size:12.5px;line-height:1.6">${t.ignore}</p>
</div></body></html>`;
  return { subject: t.subject[purpose], text, html };
}

const INVITE = {
  ar: {
    dir: 'rtl', roles: { admin: 'مدير', member: 'مشغّل', viewer: 'مشاهد' },
    subject: by => `${by} يدعوك إلى Kelvin`,
    intro: (by, role) => `${by} أضافك إلى لوحة Kelvin لمراقبة الثلاجة، بصلاحية «${role}».`,
    how: 'افتح الرابط واكتب كلمة السر التي أعطاك إياها المدير، وبعدها تقدر تغيّرها من حسابك.',
    button: 'قبول الدعوة',
    expires: d => `الرابط يُستخدم مرة واحدة وينتهي خلال ${d} أيام.`,
    ignore: 'إذا لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.',
  },
  en: {
    dir: 'ltr', roles: { admin: 'Admin', member: 'Operator', viewer: 'Viewer' },
    subject: by => `${by} invited you to Kelvin`,
    intro: (by, role) => `${by} added you to the Kelvin fridge dashboard as ${role}.`,
    how: 'Open the link and type the password the admin gave you. You can change it later in your account.',
    button: 'Accept invitation',
    expires: d => `The link works once and expires in ${d} days.`,
    ignore: 'If you were not expecting this invitation, ignore this email.',
  },
  ms: {
    dir: 'ltr', roles: { admin: 'Pentadbir', member: 'Pengendali', viewer: 'Penonton' },
    subject: by => `${by} menjemput anda ke Kelvin`,
    intro: (by, role) => `${by} menambah anda ke papan pemuka peti sejuk Kelvin sebagai ${role}.`,
    how: 'Buka pautan dan taip kata laluan yang diberi oleh pentadbir. Anda boleh menukarnya kemudian dalam akaun anda.',
    button: 'Terima jemputan',
    expires: d => `Pautan ini sekali guna dan tamat dalam ${d} hari.`,
    ignore: 'Jika anda tidak menjangka jemputan ini, abaikan e-mel ini.',
  },
};
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The invitation email: who invited them, their role, and the one-time link. Never the password. */
export function inviteEmail({ link, name, by, role, lang, days }) {
  const t = INVITE[lang] || INVITE.ar;
  const r = t.roles[role] ?? role;
  const text = `${name}

${t.intro(by, r)}
${t.how}

${link}

${t.expires(days)}
${t.ignore}

Kelvin`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f2f4;font-family:Segoe UI,Tahoma,Arial,sans-serif">
<div dir="${t.dir}" style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e2e5e9;border-radius:12px;padding:28px;color:#161b22">
<p style="margin:0 0 4px;font-weight:700;font-size:16px">Kelvin</p>
<p style="margin:0 0 6px;font-size:15px;font-weight:600">${escapeHtml(name)}</p>
<p style="margin:0 0 10px;color:#454d5a;font-size:14px;line-height:1.6">${escapeHtml(t.intro(by, r))}</p>
<p style="margin:0 0 20px;color:#454d5a;font-size:14px;line-height:1.6">${t.how}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 20px"><tr><td bgcolor="#1f3b63" style="border-radius:10px">
<a href="${escapeHtml(link)}" target="_blank" style="display:block;padding:14px 28px;border-radius:10px;background:#1f3b63;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;font-family:Segoe UI,Tahoma,Arial,sans-serif">${t.button}</a>
</td></tr></table>
<p dir="ltr" style="margin:0 0 18px;font-size:12px;color:#697281;word-break:break-all">${escapeHtml(link)}</p>
<p style="margin:0 0 6px;color:#454d5a;font-size:13px">${t.expires(days)}</p>
<p style="margin:0;color:#697281;font-size:12.5px;line-height:1.6">${t.ignore}</p>
</div></body></html>`;
  return { subject: t.subject(by), text, html };
}
