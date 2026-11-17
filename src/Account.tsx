import { useRef, useState, type FormEvent } from 'react';
import { Camera, Lock, LogOut, Mail, MailCheck, Trash2 } from 'lucide-react';
import { api, initials, type Otp, type Profile, type User } from './accountApi';
import { OtpInput, ResendButton } from './OtpInput';
import type { LockPrefs } from './LockScreen';
import { PhotoCrop } from './PhotoCrop';
import { Secret, SecretInput, SelectField } from './ui';
import { dateFormat } from './data';
import { useT } from './i18n';
import { Badges } from './Badges';

export function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  return user.avatar
    ? <img className="avatar" src={user.avatar} alt="" width={size} height={size} style={{ width: size, height: size }}/>
    : <span className="avatar avatar-initials" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(user.name)}</span>;
}

const FIELDS: (keyof Profile)[] = ['name', 'studentId', 'university', 'faculty', 'phone', 'bio'];
const MAX: Record<keyof Profile, number> = { name: 80, studentId: 32, university: 120, faculty: 120, phone: 32, bio: 500 };

type Props = {
  user: User; onUser: (u: User) => void; onSignedOut: (message: string) => void; notify: (m: string) => void;
  lockPrefs: LockPrefs; setLockPrefs: (p: LockPrefs) => void; onLock: () => void;
};

export function AccountPage({ user, onUser, onSignedOut, notify, lockPrefs, setLockPrefs, onLock }: Props) {
  const { t, lang } = useT();
  const c = t.acc, errors = t.auth.errors;
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Profile>(() => Object.fromEntries(FIELDS.map(f => [f, user[f]])) as Profile);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [deletePw, setDeletePw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ where: string; text: string } | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [pin, setPin] = useState({ password: '', code: '', confirm: '' });
  const [otp, setOtp] = useState<Otp | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpSentAt, setOtpSentAt] = useState(0);
  const [otpOffPw, setOtpOffPw] = useState('');

  const filled = FIELDS.filter(f => user[f]).length + (user.avatar ? 1 : 0);
  const complete = Math.round(filled / (FIELDS.length + 1) * 100);
  const dirty = FIELDS.some(f => draft[f] !== user[f]);

  async function run(where: string, task: () => Promise<void>) {
    setBusy(where); setError(null);
    try { await task(); }
    catch (e) { setError({ where, text: errors[e instanceof Error ? e.message : ''] ?? errors['request-failed'] }); }
    finally { setBusy(null); }
  }

  // A picked photo opens the crop window first; only the cropped square is uploaded.
  const pickPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError({ where: 'photo', text: errors['bad-image'] }); return; }
    setError(null); setCropping(file);
  };
  const savePhoto = (photo: Blob) => run('photo', async () => { onUser(await api.avatar(photo)); setCropping(null); notify(c.photoSaved); });

  const saveProfile = (e: FormEvent) => { e.preventDefault(); run('info', async () => { onUser(await api.update(draft)); notify(c.saved); }); };

  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) { setError({ where: 'password', text: c.mismatch }); return; }
    run('password', async () => { await api.password(pw.current, pw.next); setPw({ current: '', next: '', confirm: '' }); notify(c.changed); });
  };

  const deleteAccount = (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(c.confirmDelete)) return;
    run('delete', async () => { await api.remove(deletePw); onSignedOut(c.deleted); });
  };

  const savePin = (e: FormEvent) => {
    e.preventDefault();
    if (pin.code !== pin.confirm) { setError({ where: 'pin', text: t.lock.pinMismatch }); return; }
    run('pin', async () => { onUser(await api.lockCode(pin.password, pin.code)); setPin({ password: '', code: '', confirm: '' }); notify(t.lock.pinSaved); });
  };
  const removePin = () => {
    if (!pin.password) { setError({ where: 'pin', text: t.lock.needPassword }); return; }
    run('pin', async () => { onUser(await api.lockCode(pin.password, null)); setPin({ password: '', code: '', confirm: '' }); notify(t.lock.pinRemoved); });
  };

  const startOtp = () => run('otp', async () => { setOtp(await api.otpStart(lang)); setOtpCode(''); setOtpSentAt(Date.now()); });
  const confirmOtp = (value = otpCode) => {
    if (!otp || value.length !== 6) return;
    run('otp', async () => {
      try { onUser(await api.otpEnable(otp.challenge, value)); setOtp(null); notify(t.otp.enabled); }
      catch (e) { setOtpCode(''); if (e instanceof Error && e.message === 'otp-expired') setOtp(null); throw e; }
    });
  };
  const resendOtp = () => otp && run('otp', async () => { setOtp(await api.resendOtp(otp.challenge)); setOtpCode(''); setOtpSentAt(Date.now()); });
  const disableOtp = (e: FormEvent) => {
    e.preventDefault();
    run('otp', async () => { onUser(await api.otpDisable(otpOffPw)); setOtpOffPw(''); notify(t.otp.disabled); });
  };

  const errorFor = (where: string) => error?.where === where && <p className="form-error" role="alert">{error.text}</p>;

  return <div className="grid account-grid">
    <section className="panel span-all profile-hero">
      <div className="profile-photo">
        <Avatar user={user} size={112}/>
        <button type="button" className="photo-edit" onClick={() => fileInput.current?.click()} aria-label={user.avatar ? c.changePhoto : c.uploadPhoto} disabled={busy === 'photo'}><Camera size={17}/></button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }}/>
      </div>
      <div className="profile-id">
        <span className="role-tag">{t.roles[user.role]}</span>
        <h2>{user.name}</h2>
        <p className="profile-mail"><Mail size={15}/><Secret label={c.email}>{user.email}</Secret></p>
        <p className="muted">{c.memberSince(dateFormat(user.createdAt, lang))}</p>
        <div className="profile-facts">
          {user.studentId && <span><small>{c.studentId}</small><b className="mono"><Secret label={c.studentId}>{user.studentId}</Secret></b></span>}
          {user.phone && <span><small>{c.phone}</small><b className="mono"><Secret label={c.phone}>{user.phone}</Secret></b></span>}
          {user.university && <span><small>{c.university}</small><b>{user.university}</b></span>}
          {user.faculty && <span><small>{c.faculty}</small><b>{user.faculty}</b></span>}
        </div>
        {user.bio && <p className="profile-bio">{user.bio}</p>}
      </div>
      <div className="profile-side">
        <div className="completeness"><span>{c.complete(complete)}</span><div className="duty-track" aria-hidden="true"><span style={{ width: `${complete}%` }}/></div></div>
        <div className="photo-actions">
          <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={busy === 'photo'}><Camera size={16}/>{user.avatar ? c.changePhoto : c.uploadPhoto}</button>
          {user.avatar && <button type="button" className="button ghost" disabled={busy === 'photo'} onClick={() => run('photo', async () => { onUser(await api.removeAvatar()); notify(c.photoRemoved); })}>{c.removePhoto}</button>}
        </div>
        <p className="hint">{c.photoHint}</p>
        {errorFor('photo')}
      </div>
    </section>

    <Badges user={user}/>

    <section className="panel span-2">
      <header className="panel-head"><div><h2>{c.info}</h2><p>{c.infoSub}</p></div></header>
      <form onSubmit={saveProfile}>
        <div className="form-grid">
          <label>{t.auth.name}<input required maxLength={MAX.name} autoComplete="name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
          <label>{c.email}<SecretInput label={c.email} value={user.email} dir="ltr" readOnly aria-describedby="email-fixed"/><small id="email-fixed" className="field-note">{c.emailFixed}</small></label>
          <label>{c.studentId}<SecretInput label={c.studentId} maxLength={MAX.studentId} dir="ltr" value={draft.studentId} onChange={e => setDraft({ ...draft, studentId: e.target.value })}/></label>
          <label>{c.phone}<SecretInput label={c.phone} maxLength={MAX.phone} dir="ltr" type="tel" autoComplete="tel" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })}/></label>
          <label>{c.university}<input maxLength={MAX.university} value={draft.university} onChange={e => setDraft({ ...draft, university: e.target.value })}/></label>
          <label>{c.faculty}<input maxLength={MAX.faculty} value={draft.faculty} onChange={e => setDraft({ ...draft, faculty: e.target.value })}/></label>
          <label className="span-form">{c.bio}<textarea rows={3} maxLength={MAX.bio} value={draft.bio} onChange={e => setDraft({ ...draft, bio: e.target.value })}/>
            <small className="field-note">{c.bioHint} <span className="mono" dir="ltr">{draft.bio.length} / {MAX.bio}</span></small></label>
        </div>
        {errorFor('info')}
        <div className="form-actions"><button className="button primary" type="submit" disabled={!dirty || busy === 'info'}>{c.save}</button></div>
      </form>
    </section>

    <section className="panel">
      <header className="panel-head"><div><h2>{c.security}</h2><p>{c.securitySub}</p></div></header>
      <form onSubmit={changePassword} className="stack-form">
        <input type="text" autoComplete="username" value={user.email} readOnly hidden/>
        <label>{c.current}<input type="password" required dir="ltr" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })}/></label>
        <label>{c.next}<input type="password" required minLength={8} dir="ltr" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })}/><small className="field-note">{t.auth.passwordHint}</small></label>
        <label>{c.confirm}<input type="password" required minLength={8} dir="ltr" autoComplete="new-password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })}/></label>
        {errorFor('password')}
        <button className="button primary" type="submit" disabled={busy === 'password'}>{c.changePassword}</button>
      </form>
    </section>

    <section className="panel span-all otp-panel">
      <header className="panel-head">
        <div><h2>{t.otp.title}</h2><p>{t.otp.sub}</p></div>
        <span className={`pin-state ${user.otpEmail ? 'on' : ''}`}>{user.otpEmail ? t.otp.on : t.otp.off}</span>
      </header>
      {!user.emailReady && !user.otpEmail && <p className="callout otp-callout">{t.otp.notReady}</p>}
      {!user.otpEmail && user.emailReady && !otp && <div className="otp-row">
        <p className="hint">{t.otp.howItWorks}</p>
        <button type="button" className="button primary" onClick={startOtp} disabled={busy === 'otp'}><MailCheck size={16}/>{busy === 'otp' ? t.auth.working : t.otp.enable}</button>
      </div>}
      {!user.otpEmail && otp && <form className="otp-confirm" onSubmit={e => { e.preventDefault(); confirmOtp(); }}>
        <p>{t.otp.sentTo} <b dir="ltr">{otp.email}</b></p>
        <OtpInput value={otpCode} onChange={setOtpCode} onComplete={confirmOtp} disabled={busy === 'otp'} autoFocus/>
        <div className="otp-actions">
          <button className="button primary" type="submit" disabled={busy === 'otp' || otpCode.length !== 6}>{t.otp.confirm}</button>
          <ResendButton key={otpSentAt} seconds={otp.resendIn} onResend={resendOtp} disabled={busy === 'otp'}/>
          <button type="button" className="text-button" onClick={() => setOtp(null)}>{t.crop.cancel}</button>
        </div>
      </form>}
      {user.otpEmail && <form className="otp-off" onSubmit={disableOtp}>
        <p className="hint">{t.otp.whenOn}</p>
        <input type="text" autoComplete="username" value={user.email} readOnly hidden/>
        <label>{t.lock.accountPassword}<input type="password" dir="ltr" required autoComplete="current-password" value={otpOffPw} onChange={e => setOtpOffPw(e.target.value)}/></label>
        <button className="button" type="submit" disabled={!otpOffPw || busy === 'otp'}>{t.otp.disable}</button>
      </form>}
      {errorFor('otp')}
    </section>

    <section className="panel span-2 session-panel">
      <header className="panel-head"><div><h2>{t.lock.section}</h2><p>{t.lock.sectionSub}</p></div>
        <button type="button" className="button primary" onClick={onLock}><Lock size={16}/>{t.lock.now}</button></header>
      <dl className="spec-list lock-prefs">
        <div><dt>{t.lock.shortcut}</dt><dd><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd></dd></div>
        <div><dt>{t.lock.whenHidden}</dt><dd><SelectField label={t.lock.whenHidden} value={lockPrefs.hidden} onChange={v => setLockPrefs({ ...lockPrefs, hidden: v })}
          options={[['10', t.lock.after(10)], ['60', t.lock.afterMin(1)], ['now', t.lock.rightAway], ['never', t.lock.never]]}/></dd></div>
        <div><dt>{t.lock.whenIdle}</dt><dd><SelectField label={t.lock.whenIdle} value={String(lockPrefs.idle)} onChange={v => setLockPrefs({ ...lockPrefs, idle: +v as LockPrefs['idle'] })}
          options={[['0', t.lock.never], ...[1, 5, 15, 30].map(m => [String(m), t.lock.afterMin(m)] as const)]}/></dd></div>
      </dl>
      <p className="footnote lock-note">{t.lock.winNote}</p>
      <form className="pin-form" onSubmit={savePin}>
        <div className="pin-head">
          <h3>{t.lock.pinTitle}</h3>
          <span className={`pin-state ${user.hasLockCode ? 'on' : ''}`}>{user.hasLockCode ? t.lock.pinOn : t.lock.pinOff}</span>
        </div>
        <p className="hint">{t.lock.pinHint}</p>
        <input type="text" autoComplete="username" value={user.email} readOnly hidden/>
        <div className="form-grid pin-grid">
          <label>{t.lock.accountPassword}<input type="password" dir="ltr" required autoComplete="current-password" value={pin.password} onChange={e => setPin({ ...pin, password: e.target.value })}/></label>
          <label>{t.lock.newPin}<input type="password" dir="ltr" required minLength={4} maxLength={32} autoComplete="off" value={pin.code} onChange={e => setPin({ ...pin, code: e.target.value })}/></label>
          <label>{t.lock.confirmPin}<input type="password" dir="ltr" required minLength={4} maxLength={32} autoComplete="off" value={pin.confirm} onChange={e => setPin({ ...pin, confirm: e.target.value })}/></label>
        </div>
        {errorFor('pin')}
        <div className="pin-actions">
          <button className="button primary" type="submit" disabled={busy === 'pin'}>{user.hasLockCode ? t.lock.changePin : t.lock.setPin}</button>
          {user.hasLockCode && <button className="button ghost" type="button" disabled={busy === 'pin'} onClick={removePin}>{t.lock.removePin}</button>}
        </div>
      </form>
      <div className="session-row">
        <span className="muted">{c.sessionSub}</span>
        <button type="button" className="button" disabled={busy === 'logout'} onClick={() => run('logout', async () => { await api.logout(); onSignedOut(c.signedOut); })}><LogOut size={16}/>{c.signOut}</button>
      </div>
    </section>

    <section className="panel danger-panel">
      <header className="panel-head"><div><h2>{c.danger}</h2><p>{c.dangerSub}</p></div></header>
      <form onSubmit={deleteAccount} className="stack-form">
        <input type="text" autoComplete="username" value={user.email} readOnly hidden/>
        <label>{c.deletePw}<input type="password" required dir="ltr" autoComplete="current-password" value={deletePw} onChange={e => setDeletePw(e.target.value)}/></label>
        {errorFor('delete')}
        <button className="button danger" type="submit" disabled={!deletePw || busy === 'delete'}><Trash2 size={16}/>{c.deleteBtn}</button>
      </form>
    </section>
    {cropping && <PhotoCrop file={cropping} busy={busy === 'photo'} onCancel={() => setCropping(null)} onSave={savePhoto}/>}
  </div>;
}
