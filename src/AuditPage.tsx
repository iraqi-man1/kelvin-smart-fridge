import { useEffect, useMemo, useState } from 'react';
import { KeyRound, LogIn, MonitorSmartphone, RefreshCw, Search, ShieldAlert, ShieldCheck, UserCog } from 'lucide-react';
import { api, type AuditEntry } from './accountApi';
import { dateFormat, timeFormat } from './data';
import { useT } from './i18n';
import { Segmented } from './ui';

type Filter = 'all' | 'signin' | 'admin' | 'device';
const GROUP: Record<Exclude<Filter, 'all'>, string[]> = {
  signin: ['login', 'login-failed', 'login-blocked', 'account-locked', 'new-device', 'logout', 'password-changed', 'password-reset', 'otp-on', 'otp-off', 'account-deleted', 'invite-accepted'],
  admin: ['invite-sent', 'invite-resent', 'invite-revoked', 'role-changed', 'user-removed', 'password-viewed', 'password-set', 'alerts-changed', 'support-changed', 'settings-changed'],
  device: ['key-created', 'key-rotated', 'key-revoked', 'device-command'],
};
// Entries worth a second look are marked.
const WARN = new Set(['login-failed', 'login-blocked', 'account-locked', 'new-device', 'password-viewed', 'user-removed', 'key-revoked']);
const PAGE = 30;
const DAY = 86400000;

/** Admin only: who did what and when (sign-ins, admin changes, device keys and commands). */
export function AuditPage() {
  const { t, lang } = useT();
  const a = t.audit;
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [vaultKey, setVaultKey] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setBusy(true); setError('');
    try { setEntries(await api.audit()); } catch { setError(t.auth.errors['request-failed']); } finally { setBusy(false); }
  }
  useEffect(() => {
    load();
    fetch('/api/info').then(r => r.json()).then(i => setVaultKey(Boolean(i?.system?.vaultKey))).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setShown(PAGE), [filter, query]);

  const now = Date.now();
  const stats = useMemo(() => {
    const list = entries ?? [];
    const since = (ms: number, ...actions: string[]) => list.filter(e => now - e.at < ms && actions.includes(e.action)).length;
    return [
      { label: a.cards.logins, value: since(7 * DAY, 'login'), icon: LogIn, tone: '' },
      { label: a.cards.failed, value: since(DAY, 'login-failed', 'login-blocked'), icon: ShieldAlert, tone: since(DAY, 'login-failed', 'login-blocked') ? 'warn' : '' },
      { label: a.cards.devices, value: since(7 * DAY, 'new-device'), icon: MonitorSmartphone, tone: '' },
      { label: a.cards.admin, value: since(7 * DAY, ...GROUP.admin, ...GROUP.device.filter(x => x !== 'device-command')), icon: UserCog, tone: '' },
    ];
  }, [entries, a, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter(e => filter === 'all' || GROUP[filter].includes(e.action)).filter(e => !q || [
      a.actions[e.action] ?? e.action, e.actor?.name, e.actor?.email, e.target?.name, e.target?.email, e.detail, e.ip, e.browser,
    ].some(v => v && String(v).toLowerCase().includes(q)));
  }, [entries, filter, query, a]);

  const roleName = (r: string) => (r === 'admin' || r === 'member' || r === 'viewer' ? t.roles[r] : r);
  const detail = (e: AuditEntry) => {
    if (e.action === 'role-changed') return `${e.target?.name ?? ''} → ${roleName(e.detail)}`;
    if (e.action === 'invite-sent' && e.detail) return `${e.target?.name ?? ''} · ${roleName(e.detail)}`;
    if (e.action === 'device-command') return a.commands[e.detail] ?? e.detail;
    return [e.target?.name ?? e.target?.email, e.detail].filter(Boolean).join(' · ');
  };

  return <div className="grid">
    {vaultKey === false && <section className="panel span-all audit-advice" role="note">
      <ShieldAlert size={20}/>
      <div><h3>{a.vaultTitle}</h3><p>{a.vaultText}</p></div>
    </section>}

    <section className="panel span-all audit-cards" aria-label={a.summary}>
      {stats.map(s => <div key={s.label} className={`audit-card ${s.tone}`}>
        <s.icon size={18}/><b className="mono">{entries ? s.value : '—'}</b><span>{s.label}</span>
      </div>)}
    </section>

    <section className="panel span-all audit-panel">
      <header className="panel-head">
        <div><h2>{a.title}</h2><p>{entries ? a.count(visible.length) : a.loading}</p></div>
        <button className="button" onClick={load} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''}/>{t.refresh}</button>
      </header>
      <div className="audit-tools">
        <Segmented label={a.filter} value={filter} onChange={setFilter} options={[['all', a.filters.all], ['signin', a.filters.signin], ['admin', a.filters.admin], ['device', a.filters.device]]}/>
        <label className="search-field"><Search size={15}/><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={a.search} aria-label={a.search}/></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="table-scroll"><table className="audit-table">
        <thead><tr><th>{a.cols.when}</th><th>{a.cols.what}</th><th>{a.cols.who}</th><th>{a.cols.detail}</th><th>{a.cols.from}</th></tr></thead>
        <tbody>{visible.slice(0, shown).map(e => <tr key={e.id} className={WARN.has(e.action) ? 'warn' : ''}>
          <td className="nowrap" data-label={a.cols.when}><div><span>{dateFormat(e.at, lang)}</span> <span className="mono muted" dir="ltr">{timeFormat(e.at)}</span></div></td>
          <td data-label={a.cols.what}><div><span className={`audit-action ${WARN.has(e.action) ? 'warn' : GROUP.device.includes(e.action) ? 'device' : GROUP.admin.includes(e.action) ? 'admin' : ''}`}>
            {WARN.has(e.action) ? <ShieldAlert size={14}/> : GROUP.device.includes(e.action) ? <KeyRound size={14}/> : <ShieldCheck size={14}/>}{a.actions[e.action] ?? e.action}
          </span></div></td>
          <td data-label={a.cols.who}><div>{e.actor ? <><b>{e.actor.name}</b><small className="muted block" dir="ltr">{e.actor.email}</small></> : <span className="muted">{a.unknown}</span>}</div></td>
          <td className="audit-detail" data-label={a.cols.detail}><div>{detail(e) ? <bdi>{detail(e)}</bdi> : <span className="muted">—</span>}</div></td>
          <td data-label={a.cols.from}><div><span className="mono" dir="ltr">{e.ip || '—'}</span>{e.browser && <small className="muted block" dir="ltr">{e.browser}</small>}</div></td>
        </tr>)}</tbody>
      </table></div>
      {entries && !visible.length && <div className="empty-state">{a.empty}</div>}
      {visible.length > shown && <div className="audit-more"><button className="button ghost" onClick={() => setShown(s => s + PAGE)}>{a.more(visible.length - shown)}</button></div>}
      <p className="hint">{a.note}</p>
    </section>
  </div>;
}
