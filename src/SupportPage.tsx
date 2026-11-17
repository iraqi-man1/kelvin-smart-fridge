import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, LifeBuoy, Send, Settings2 } from 'lucide-react';
import { api, canManage, type SupportCategory, type SupportConfig, type Ticket, type User } from './accountApi';
import { dateFormat, timeFormat } from './data';
import { useT } from './i18n';
import { SecretInput, Segmented, SelectField, SwitchField } from './ui';

const CATEGORIES: SupportCategory[] = ['fault', 'problem', 'account', 'question'];

/** Report a fault or a problem to the IT team's Telegram bot; the admin links that bot here. */
export function SupportPage({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { t, lang } = useT();
  const s = t.support;
  const admin = canManage(user);
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [category, setCategory] = useState<SupportCategory>('fault');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Ticket | null>(null);
  // Admin: the IT bot
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [botLang, setBotLang] = useState<'ar' | 'en' | 'ms'>('ar');
  const [botBusy, setBotBusy] = useState(false);
  const say = (e: unknown) => t.auth.errors[e instanceof Error ? e.message : ''] ?? t.auth.errors['request-failed'];

  const load = useCallback(() => api.support().then(r => { setConfig(r.config); setEnabled(r.config.enabled); setBotLang(r.config.lang); setTickets(r.tickets); }).catch(e => setError(say(e))), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault(); setError(''); setSent(null);
    if (message.trim().length < 5) { setError(t.auth.errors['support-too-short']); return; }
    setBusy(true);
    try { const ticket = await api.report(category, message.trim()); setSent(ticket); setMessage(''); notify(s.sent); load(); }
    catch (err) { setError(say(err)); }
    finally { setBusy(false); }
  }
  async function saveBot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBotBusy(true);
    const chatId = String(new FormData(e.currentTarget).get('chatId') ?? '');
    try { setConfig(await api.supportConfig({ enabled, chatId, lang: botLang, ...(token ? { token } : {}) })); setToken(''); notify(s.botSaved); }
    catch (err) { notify(say(err)); }
    finally { setBotBusy(false); }
  }
  async function testBot() {
    setBotBusy(true);
    try { await api.supportTest(); notify(s.testSent); } catch (err) { notify(say(err)); } finally { setBotBusy(false); }
  }

  const ready = config?.configured && config.enabled;

  return <div className="grid">
    <section className="panel span-2 support-panel">
      <header className="panel-head"><div><h2>{s.title}</h2><p>{s.sub}</p></div><LifeBuoy size={20} className="muted"/></header>
      {config && !ready && <p className="readonly-note" role="note"><Settings2 size={15}/>{admin ? s.notLinkedAdmin : s.notLinked}</p>}
      <form className="support-form" onSubmit={send} noValidate>
        <div className="support-field"><span className="support-label">{s.kind}</span>
          <Segmented label={s.kind} value={category} onChange={setCategory} options={CATEGORIES.map(c => [c, s.cats[c]] as const)}/></div>
        <label className="support-field"><span className="support-label">{s.message}</span>
          <textarea rows={6} maxLength={1000} dir={t.dir} value={message} onChange={e => setMessage(e.target.value)} placeholder={s.placeholder[category]}/>
          <span className="support-count mono" dir="ltr">{message.length} / 1000</span></label>
        <p className="hint">{s.whatGoes}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {sent && <p className="support-sent" role="status"><CircleCheck size={16}/>{s.sentAs(sent.id)}</p>}
        <div className="modal-actions"><button className="button primary" type="submit" disabled={busy || !ready}><Send size={15}/>{busy ? s.sending : s.send}</button></div>
      </form>
    </section>

    <section className="panel support-history">
      <header className="panel-head"><div><h2>{admin ? s.allReports : s.myReports}</h2><p>{tickets.length ? s.count(tickets.length) : s.none}</p></div></header>
      <ul className="ticket-list">{tickets.map(x => <li key={x.id}>
        <div className="ticket-top"><span className={`ticket-cat ${x.category}`}>{s.cats[x.category]}</span><span className="mono muted">#{x.id}</span></div>
        <p>{x.message}</p>
        <small className="muted">{admin && <b>{x.name} · </b>}{dateFormat(x.at, lang)} {timeFormat(x.at)}</small>
      </li>)}</ul>
    </section>

    {admin && config && <section className="panel span-all form-page">
      <header className="panel-head"><div><h2>{s.botTitle}</h2><p>{s.botSub}</p></div></header>
      <form onSubmit={saveBot}>
        <SwitchField checked={enabled} onChange={setEnabled}>{s.enable}</SwitchField>
        <p className="hint tg-hint">{config.configured ? s.linked : s.notLinkedShort} {s.howTo}</p>
        <fieldset><div className="form-grid">
          <label>{t.tg.token}<input type="password" dir="ltr" autoComplete="off" disabled={config.fromEnv} placeholder={config.configured ? t.tg.tokenKept : '123456:ABC…'} value={token} onChange={e => setToken(e.target.value)}/></label>
          <label>{s.chatId}<SecretInput label={s.chatId} name="chatId" dir="ltr" defaultValue={config.chatId}/></label>
          <label>{s.botLang}<SelectField label={s.botLang} value={botLang} onChange={setBotLang} options={[['ar', 'العربية'], ['en', 'English'], ['ms', 'Bahasa Melayu']] as const}/></label>
        </div></fieldset>
        <div className="modal-actions">
          <button className="button primary" type="submit" disabled={botBusy}>{t.tg.save}</button>
          <button className="button ghost" type="button" disabled={botBusy || !config.configured} onClick={testBot}>{t.tg.test}</button>
        </div>
      </form>
    </section>}
  </div>;
}
