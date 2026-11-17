import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BellRing, Lightbulb, MessageSquareText, RotateCcw, ShieldAlert, ShieldCheck, Timer, X } from 'lucide-react';
import { api, canControl, type Command, type DeviceStatus, type User } from './accountApi';
import { timeFormat } from './data';
import { useT } from './i18n';
import { SelectField } from './ui';

const describe = (c: Command, t: ReturnType<typeof useT>['t']) => {
  const ctl = t.ctl;
  if (c.type === 'beep') return ctl.beepN(Number(c.value));
  if (c.type === 'led') return `${ctl.names.led}: ${ctl[c.value as 'on' | 'off' | 'blink']}`;
  if (c.type === 'message') return `${ctl.names.message}: “${c.value}”`;
  if (c.type === 'interval') return `${ctl.names.interval}: ${ctl.every(Number(c.value))}`;
  return ctl.names.reboot;
};

/** Send commands to the ESP32; they ride back on the reply to its next reading. */
export function DeviceControl({ user, mode, notify }: { user: User; mode: 'demo' | 'live'; notify: (m: string) => void }) {
  const { t } = useT();
  const c = t.ctl;
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [message, setMessage] = useState('');
  const [interval, setIntervalValue] = useState('5');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const allowed = canControl(user);

  const load = useCallback(() => api.device().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); const id = setInterval(() => { if (!document.hidden) load(); setNow(Date.now()); }, 5000); return () => clearInterval(id); }, [load]);

  async function send(type: Command['type'], value?: unknown) {
    setError('');
    try { await api.command(type, value); notify(c.queued); load(); }
    catch (e) { setError(t.auth.errors[e instanceof Error ? e.message : ''] ?? t.auth.errors['request-failed']); }
  }
  const sendMessage = (e: FormEvent) => { e.preventDefault(); if (message.trim()) { send('message', message.trim()); setMessage(''); } };
  const asciiOnly = /^[\x20-\x7E]*$/.test(message);

  const seen = status?.lastSeen ? t.ago(Math.max(0, Math.round((now - status.lastSeen) / 1000))) : null;

  return <section className="panel span-all control-panel">
    <header className="panel-head">
      <div><h2>{c.title}</h2><p>{c.sub}</p></div>
      <div className="control-state">
        {status && <span className={`guard ${status.protected ? 'ok' : 'warn'}`}>{status.protected ? <ShieldCheck size={15}/> : <ShieldAlert size={15}/>}{status.protected ? c.protected : c.unprotected}</span>}
        <span className="muted">{seen ? c.lastSeen(seen) : c.neverSeen}</span>
      </div>
    </header>
    {mode === 'demo' && <p className="callout control-note">{c.demoNote}</p>}
    {!allowed && <p className="callout control-note">{c.viewerNote}</p>}

    <div className="control-grid" aria-disabled={!allowed}>
      <div className="control-card">
        <h3><BellRing size={16}/>{c.beep}</h3>
        <div className="control-row">{[1, 2, 3].map(n => <button key={n} type="button" className="button" disabled={!allowed} onClick={() => send('beep', n)}>{c.beepN(n)}</button>)}</div>
      </div>
      <div className="control-card">
        <h3><Lightbulb size={16}/>{c.led}</h3>
        <div className="control-row">{(['on', 'blink', 'off'] as const).map(v => <button key={v} type="button" className="button" disabled={!allowed} onClick={() => send('led', v)}>{c[v]}</button>)}</div>
      </div>
      <form className="control-card control-message" onSubmit={sendMessage}>
        <h3><MessageSquareText size={16}/>{c.message}</h3>
        <div className="control-row">
          <input dir="ltr" maxLength={40} value={message} onChange={e => setMessage(e.target.value)} disabled={!allowed} placeholder="Door open, check food" aria-label={c.message} aria-invalid={!asciiOnly}/>
          <button type="submit" className="button primary" disabled={!allowed || !message.trim() || !asciiOnly}>{c.send}</button>
        </div>
        <small className={asciiOnly ? 'field-note' : 'field-note bad'}>{c.messageHint}</small>
      </form>
      <div className="control-card">
        <h3><Timer size={16}/>{c.interval}</h3>
        <div className="control-row">
          <SelectField label={c.interval} value={interval} onChange={setIntervalValue} options={[2, 5, 10, 30, 60].map(s => [String(s), c.every(s)] as const)}/>
          <button type="button" className="button" disabled={!allowed} onClick={() => send('interval', Number(interval))}>{c.apply}</button>
        </div>
      </div>
      <div className="control-card">
        <h3><RotateCcw size={16}/>{c.reboot}</h3>
        <div className="control-row"><button type="button" className="button danger" disabled={!allowed} onClick={() => { if (window.confirm(c.confirmReboot)) send('reboot'); }}><RotateCcw size={15}/>{c.reboot}</button></div>
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}

    <h3 className="sub-head">{c.recent}</h3>
    {status?.commands.length ? <ul className="command-list">{status.commands.slice(0, 8).map(cmd => <li key={cmd.id}>
      <span className={`cmd-status ${cmd.status}`}>{c.status[cmd.status]}</span>
      <span className="cmd-what">{describe(cmd, t)}</span>
      <span className="muted">{cmd.by} · <span dir="ltr" className="mono">{timeFormat(cmd.createdAt)}</span></span>
      {allowed && cmd.status === 'pending' && <button type="button" className="icon-button" aria-label={c.cancel} title={c.cancel} onClick={() => api.cancelCommand(cmd.id).then(setStatus).catch(() => {})}><X size={15}/></button>}
    </li>)}</ul> : <p className="muted">{c.noCommands}</p>}
  </section>;
}
