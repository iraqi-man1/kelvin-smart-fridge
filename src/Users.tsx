import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Eye, EyeOff, MailCheck, RotateCw, Send, ShieldCheck, Trash2, UserPlus, WandSparkles } from 'lucide-react';
import { Avatar } from './Account';
import { api, type Invite, type Role, type User } from './accountApi';
import { dateFormat } from './data';
import { useT } from './i18n';
import { Secret, SelectField } from './ui';

const ROLES: Role[] = ['admin', 'member', 'viewer'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A password that is easy to read out: no 0/O or 1/l/I. */
function makePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, b => chars[b % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** A password field with show/hide, "Make one" and "Copy". */
function PasswordField({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  const { t } = useT();
  const u = t.users;
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  return <>
    <span className="pw-row">
      <input required aria-label={label} type={show ? 'text' : 'password'} dir="ltr" maxLength={200} autoComplete="new-password" autoFocus={autoFocus}
        value={value} onChange={e => { onChange(e.target.value); setCopied(false); }}/>
      <button type="button" className="icon-button" onClick={() => setShow(v => !v)} aria-label={show ? t.auth.hide : t.auth.show}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
    </span>
    <span className="pw-tools">
      <button type="button" className="text-button" onClick={() => { onChange(makePassword()); setShow(true); setCopied(false); }}><WandSparkles size={14}/>{u.generate}</button>
      {value && <button type="button" className="text-button" onClick={async () => setCopied(await copyText(value))}>{copied ? <Check size={14}/> : <Copy size={14}/>}{u.copyPw}</button>}
    </span>
  </>;
}

/** The password column: what the admin set (shown on request), or "chosen by them"; and Change. */
function PasswordCell({ user, onError, notify, reload }: { user: User; onError: (e: unknown) => void; notify: (m: string) => void; reload: () => void }) {
  const { t } = useT();
  const u = t.users;
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const info = user.password;

  async function reveal() {
    if (shown !== null) { setShown(null); return; }
    try { setShown((await api.revealPassword(user.id)).password ?? ''); } catch (e) { onError(e); }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) { onError(new Error('weak-password')); return; }
    setBusy(true);
    try { await api.setPassword(user.id, next); notify(u.pwSaved); setEditing(false); setNext(''); setShown(null); reload(); }
    catch (e) { onError(e); }
    finally { setBusy(false); }
  }

  if (editing) return <form className="pw-edit" onSubmit={save} noValidate>
    <PasswordField value={next} onChange={setNext} label={u.newPw} autoFocus/>
    <span className="pw-edit-actions">
      <button type="submit" className="button primary small" disabled={busy}>{u.save}</button>
      <button type="button" className="text-button" onClick={() => { setEditing(false); setNext(''); }}>{u.cancel}</button>
    </span>
  </form>;

  return <span className="pw-cell">
    {info?.known
      ? <>
        <code dir="ltr" className={`pw-value ${shown === null ? 'is-hidden' : ''}`}>{shown === null ? '••••••••' : shown || '—'}</code>
        <button type="button" className="icon-button" onClick={reveal} aria-label={shown === null ? u.reveal : u.conceal} title={shown === null ? u.reveal : u.conceal}>{shown === null ? <Eye size={15}/> : <EyeOff size={15}/>}</button>
        {shown && <button type="button" className="icon-button" onClick={async () => setCopied(await copyText(shown))} aria-label={u.copyPw} title={u.copyPw}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button>}
      </>
      : <span className="muted">{info?.self ? u.pwSelf : u.pwUnknown}</span>}
    <button type="button" className="text-button" onClick={() => setEditing(true)}>{u.change}</button>
  </span>;
}

export function UsersPage({ me, notify }: { me: User; notify: (m: string) => void }) {
  const { t, lang } = useT();
  const u = t.users;
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState<Role>('member');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState<{ email: string; link: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const err = (e: unknown) => setError(t.auth.errors[e instanceof Error ? e.message : ''] ?? t.auth.errors['request-failed']);

  const load = useCallback(() => api.adminUsers().then(r => { setUsers(r.users); setInvites(r.invites); }).catch(err), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault(); setError(''); setSent(null);
    // Say what is missing instead of a button that silently does nothing.
    const to = email.trim();
    if (!name.trim()) return err(new Error('name-required'));
    if (!EMAIL.test(to)) return err(new Error('invalid-email'));
    if (password.length < 8) return err(new Error('weak-password'));
    setBusy(true);
    try {
      const r = await api.invite({ name: name.trim(), email: to, role, password, lang });
      notify(u.sentTo(to));
      setSent({ email: to, link: r.link }); setLinkCopied(false);
      setName(''); setEmail(''); setPassword('');
      load();
    } catch (e) { err(e); }
    finally { setBusy(false); }
  }
  async function resend(i: Invite) {
    setError('');
    try { const r = await api.resendInvite(i.id, lang); notify(u.resent(i.email)); setSent({ email: i.email, link: r.link }); setLinkCopied(false); load(); }
    catch (e) { err(e); }
  }

  return <div className="grid users-grid">
    <section className="panel span-2">
      <header className="panel-head"><div><h2>{u.inviteTitle}</h2><p>{u.inviteSub}</p></div><UserPlus size={20} className="muted"/></header>
      <form className="invite-form" onSubmit={invite} noValidate>
        <label>{u.name}<input maxLength={80} autoComplete="off" value={name} onChange={e => setName(e.target.value)}/></label>
        <label>{u.email}<input type="email" dir="ltr" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label>
        <label>{u.role}<SelectField label={u.role} value={role} onChange={setRole} options={ROLES.map(r => [r, t.roles[r]] as const)}/>
          <small className="field-note">{t.roles.help[role]}</small></label>
        <div className="invite-pw"><span className="invite-pw-label">{u.password}</span>
          <PasswordField value={password} onChange={setPassword} label={u.password}/>
          <small className="field-note">{u.passwordHint}</small></div>
        <button className="button primary" type="submit" disabled={busy}><Send size={15}/>{busy ? u.sending : u.send}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {sent && <div className="invite-sent" role="status">
        <p><MailCheck size={16}/><b>{u.sentTo(sent.email)}</b></p>
        <p className="muted">{u.spamHint}</p>
        <button type="button" className="button" onClick={async () => { if (await copyText(sent.link)) { setLinkCopied(true); notify(u.linkCopied); } }}>{linkCopied ? <Check size={15}/> : <Copy size={15}/>}{u.copyLink}</button>
      </div>}
      <h3 className="sub-head">{u.pending}</h3>
      {invites.length ? <ul className="invite-list">{invites.map(i => <li key={i.id}>
        <span className={`role-pill ${i.role}`}>{t.roles[i.role]}</span>
        <span className="invite-email">{i.name && <b>{i.name} </b>}<span dir="ltr">{i.email}</span></span>
        <span className="muted">{u.expires(dateFormat(i.expires, lang))}</span>
        <button type="button" className="text-button" onClick={() => resend(i)}><RotateCw size={13}/> {u.resend}</button>
        <button type="button" className="text-button" onClick={() => api.revokeInvite(i.id).then(() => { notify(u.revoked); load(); }).catch(err)}>{u.revoke}</button>
      </li>)}</ul> : <p className="muted">{u.none}</p>}
    </section>

    <section className="panel">
      <header className="panel-head"><div><h2>{u.rolesTitle}</h2><p>{u.rolesSub}</p></div></header>
      <ul className="role-help">{ROLES.map(r => <li key={r}><span className={`role-pill ${r}`}>{t.roles[r]}</span>{t.roles.help[r]}</li>)}</ul>
    </section>

    <section className="panel span-all">
      <header className="panel-head"><div><h2>{u.list}</h2><p>{users.length}</p></div></header>
      <div className="table-scroll"><table className="users-table">
        <thead><tr><th/><th>{t.auth.email}</th><th>{u.role}</th><th>{u.pwCol}</th><th>{u.joined}</th><th/></tr></thead>
        <tbody>{users.map(x => <tr key={x.id}>
          <td><span className="user-cell"><Avatar user={x} size={32}/><span><b>{x.name}</b>{x.id === me.id && <small className="you-tag">{u.you}</small>}</span></span></td>
          <td><Secret label={t.auth.email}>{x.email}</Secret>{x.otpEmail && <span className="otp-tag" title={u.twoStep}><ShieldCheck size={14}/></span>}</td>
          <td><SelectField label={u.role} value={x.role} onChange={r => api.setRole(x.id, r).then(() => { notify(u.roleSaved); load(); }).catch(err)}
            options={ROLES.map(r => [r, t.roles[r]] as const)}/></td>
          <td>{x.id === me.id ? <span className="muted">—</span> : <PasswordCell user={x} onError={err} notify={notify} reload={load}/>}</td>
          <td className="muted">{dateFormat(x.createdAt, lang)}</td>
          <td>{x.id !== me.id && <button type="button" className="button ghost danger-ghost" onClick={() => {
            if (window.confirm(u.confirmRemove(x.name))) api.removeUser(x.id).then(() => { notify(u.removed); load(); }).catch(err);
          }}><Trash2 size={15}/>{u.remove}</button>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
