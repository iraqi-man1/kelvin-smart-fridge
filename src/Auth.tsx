import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail, MailCheck, ShieldCheck, Ticket, User as UserIcon } from 'lucide-react';
import { api, type InvitePreview, type Otp, type User } from './accountApi';
import { OtpInput, ResendButton } from './OtpInput';
import { createDemoHistory, fmt, metricInfo } from './data';
import { dictionaries, langs, useT } from './i18n';
import { ThemeToggle, TooltipProvider, useTheme } from './ui';
import type { Lang, Metric } from './types';

type Props = { onSignedIn: (u: User) => void; setLang: (l: Lang) => void; notice?: string; app: string; student: string };

/** 0 to 4: length, mixed case, a digit, a symbol or 12+ characters. */
function strength(p: string) {
  if (p.length < 8) return p ? 1 : 0;
  return 1 + Number(/[a-z]/.test(p) && /[A-Z]/.test(p)) + Number(/\d/.test(p)) + Number(/[^A-Za-z0-9]/.test(p) || p.length >= 12) as number;
}

/** A small live-looking Kelvin widget, drawn from the same demo data the dashboard uses. */
function ReadoutCard() {
  const { t } = useT();
  const history = useMemo(() => createDemoHistory().slice(-36), []);
  const last = history.at(-1)!;
  const temps = history.map(r => r.temperature);
  const lo = Math.min(...temps) - 1, hi = Math.max(...temps) + 1;
  const path = temps.map((v, i) => `${i ? 'L' : 'M'}${(i / (temps.length - 1) * 200).toFixed(1)},${(40 - (v - lo) / (hi - lo) * 36).toFixed(1)}`).join('');
  const rows: Metric[] = ['temperature', 'humidity', 'eco2'];
  return <div className="auth-widget" aria-hidden="true">
    <div className="auth-widget-head"><span className="live-dot"/>{t.auth.widget}<span className="auth-widget-tag">{t.status.demo}</span></div>
    <svg viewBox="0 0 200 42" preserveAspectRatio="none"><path d={path} fill="none" stroke={metricInfo.temperature.color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></svg>
    <dl>{rows.map(m => <div key={m}><dt><i style={{ background: metricInfo[m].color }}/>{t.metric[m].short}</dt><dd dir="ltr"><b>{fmt(m, last[m])}</b> {metricInfo[m].unit}</dd></div>)}</dl>
  </div>;
}

export function AuthScreen({ onSignedIn, setLang, notice, app, student }: Props) {
  const { t, lang } = useT();
  const a = t.auth;
  const { theme, toggle } = useTheme();
  // The emailed invitation link (/?invite=CODE) opens "You are invited": the name and email
  // the admin set, and the password the admin gave them.
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(location.search).get('invite') ?? '');
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteGone, setInviteGone] = useState(false);
  useEffect(() => { if (inviteCode) api.previewInvite(inviteCode).then(setInvite).catch(() => setInviteGone(true)); }, [inviteCode]);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  // Only the very first account signs itself up; after that it is invitations only.
  const [signup, setSignup] = useState<{ firstAccount: boolean } | null>(null);
  useEffect(() => { api.signupInfo().then(setSignup).catch(() => {}); }, []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [otp, setOtp] = useState<Otp | null>(null);
  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState(0);
  // Forgotten password: first the email, then the emailed code with a new password.
  const [forgot, setForgot] = useState(false);
  const [resetOtp, setResetOtp] = useState<Otp | null>(null);
  const [resetCode, setResetCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const Go = t.dir === 'rtl' ? ArrowLeft : ArrowRight;
  const score = strength(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'up') {
        onSignedIn(await api.register(name, email, password));
        return;
      }
      const r = await api.login(email, password, lang);
      if (r.otp) { setOtp(r.otp); setCode(''); setSentAt(Date.now()); }
      else if (r.user) onSignedIn(r.user);
    }
    catch (err) { setError(err instanceof Error ? err.message : 'request-failed'); }
    finally { setBusy(false); }
  }

  async function verify(value = code) {
    if (!otp || value.length !== 6) return;
    setBusy(true); setError('');
    try { onSignedIn(await api.verifyOtp(otp.challenge, value)); }
    catch (err) {
      const c = err instanceof Error ? err.message : 'request-failed';
      setError(c); setCode('');
      if (c === 'otp-expired') setOtp(null);
    } finally { setBusy(false); }
  }
  async function resend() {
    if (!otp) return;
    setError('');
    try { setOtp(await api.resendOtp(otp.challenge)); setCode(''); setSentAt(Date.now()); }
    catch (err) { setError(err instanceof Error ? err.message : 'request-failed'); }
  }
  const switchTo = (m: 'in' | 'up') => { setMode(m); setError(''); };

  async function accept(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const u = await api.acceptInvite(inviteCode, password);
      history.replaceState(null, '', location.pathname); // the link is used up
      onSignedIn(u);
    } catch (err) {
      const c = err instanceof Error ? err.message : 'request-failed';
      if (c === 'invite-invalid') setInviteGone(true);
      setError(c);
    } finally { setBusy(false); }
  }
  const leaveInvite = () => { history.replaceState(null, '', location.pathname); setInviteCode(''); setInvite(null); setInviteGone(false); setError(''); setPassword(''); };

  async function requestReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { setResetOtp(await api.resetRequest(email, lang)); setResetCode(''); setSentAt(Date.now()); }
    catch (err) { setError(err instanceof Error ? err.message : 'request-failed'); }
    finally { setBusy(false); }
  }
  async function confirmReset(e: FormEvent) {
    e.preventDefault();
    if (!resetOtp) return;
    if (newPw !== newPw2) { setError('mismatch'); return; }
    setBusy(true); setError('');
    try { onSignedIn(await api.resetConfirm(resetOtp.challenge, resetCode, newPw)); }
    catch (err) {
      const c = err instanceof Error ? err.message : 'request-failed';
      setError(c);
      if (c === 'wrong-otp') setResetCode('');
      if (c === 'otp-expired') { setResetOtp(null); setResetCode(''); }
    } finally { setBusy(false); }
  }
  async function resendReset() {
    if (!resetOtp) return;
    setError('');
    try { setResetOtp(await api.resendOtp(resetOtp.challenge)); setResetCode(''); setSentAt(Date.now()); }
    catch (err) { setError(err instanceof Error ? err.message : 'request-failed'); }
  }
  const leaveReset = () => { setForgot(false); setResetOtp(null); setResetCode(''); setNewPw(''); setNewPw2(''); setError(''); setPassword(''); };
  const message = error && (error === 'mismatch' ? t.acc.mismatch : a.errors[error] ?? a.errors['request-failed']);

  const tools = <div className="auth-tools">
    <div className="lang-switch" role="group" aria-label={t.language}>
      {langs.map(([l, label]) => <button key={l} lang={l} aria-pressed={lang === l} title={dictionaries[l].langName} onClick={() => setLang(l)}>{label}</button>)}
    </div>
    <ThemeToggle theme={theme} onToggle={toggle}/>
  </div>;
  const brand = <div className="brand auth-brandline"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span><div><span className="wordmark" lang="en">{app}</span><small>{t.tagline}</small></div></div>;

  return <TooltipProvider delayDuration={300}><div className="auth-page">
    {/* Phones and iPads: one top bar with the name and the language/theme buttons. */}
    <header className="auth-mhead">{brand}{tools}</header>
    <section className="auth-stage">
      {brand}
      <div className="auth-copy">
        <p className="auth-eyebrow enter" style={{ '--i': 0 } as CSSProperties}>{a.eyebrow}</p>
        <h1 className="enter" style={{ '--i': 1 } as CSSProperties}>{a.headline}</h1>
        <p className="auth-fact enter" style={{ '--i': 2 } as CSSProperties}>{a.fact}</p>
      </div>
      <div className="auth-product enter" style={{ '--i': 3 } as CSSProperties}>
        <div className="auth-product-card">
          <img src="/fridge.png" alt={a.fridgeAlt} width={700} height={700} loading="eager"/>
        </div>
        <ReadoutCard/>
        <span className="auth-chip" aria-hidden="true" dir="ltr">ESP32 · DHT11 · CCS811</span>
      </div>
      <p className="auth-credit">{t.designedBy} <b lang="en">{student}</b> · Universiti Sains Malaysia</p>
    </section>

    <main className="auth-main">
      {tools}

      {inviteCode ? <form className="auth-card otp-card invite-card" onSubmit={accept} noValidate>
        <span className="otp-icon" aria-hidden="true"><Ticket size={26}/></span>
        <h2>{a.inviteTitle}</h2>
        {inviteGone ? <p className="auth-sub">{a.inviteGone}</p> : !invite ? <p className="auth-sub">{a.working}</p> : <>
          <p className="auth-sub">{a.inviteFor(invite.by, t.roles[invite.role])}</p>
          <div className="auth-fields">
            <label>{a.name}
              <span className="auth-input"><UserIcon size={17}/><input readOnly value={invite.name}/></span></label>
            <label>{a.email}
              <span className="auth-input"><Mail size={17}/><input readOnly type="email" dir="ltr" autoComplete="username" value={invite.email}/></span></label>
            <label>{a.invitePw}
              <span className="auth-input"><Lock size={17}/>
                <input required autoFocus type={show ? 'text' : 'password'} dir="ltr" minLength={8} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/>
                <button type="button" className="icon-button" onClick={() => setShow(v => !v)} aria-label={show ? a.hide : a.show}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
              </span>
              <small>{a.inviteNote}</small></label>
          </div>
          {message && <p className="auth-error" role="alert">{message}</p>}
          <button className="button primary auth-submit" type="submit" disabled={busy || password.length < 8}>{busy ? a.working : a.inviteSubmit}{!busy && <Go size={17}/>}</button>
        </>}
        <p className="auth-switch"><button type="button" className="text-button" onClick={leaveInvite}>{a.toSignIn}</button></p>
      </form> : forgot ? <form className="auth-card otp-card reset-card" onSubmit={resetOtp ? confirmReset : requestReset} noValidate>
        <span className="otp-icon" aria-hidden="true"><KeyRound size={26}/></span>
        <h2>{t.reset.title}</h2>
        {!resetOtp ? <>
          <p className="auth-sub">{t.reset.intro}</p>
          <div className="auth-fields">
            <label>{a.email}
              <span className="auth-input"><Mail size={17}/><input required type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus/></span></label>
          </div>
          {message && <p className="auth-error" role="alert">{message}</p>}
          <button className="button primary auth-submit" type="submit" disabled={busy || !email}>{busy ? a.working : t.reset.send}{!busy && <Go size={17}/>}</button>
        </> : <>
          <p className="auth-sub">{t.otp.sentTo} <b dir="ltr">{resetOtp.email}</b>. {t.reset.ifAccount}</p>
          <div className="otp-field"><OtpInput value={resetCode} onChange={setResetCode} disabled={busy} autoFocus/></div>
          <div className="auth-fields">
            <input type="text" autoComplete="username" value={email} readOnly hidden/>
            <label>{t.acc.next}
              <span className="auth-input"><Lock size={17}/>
                <input required type={show ? 'text' : 'password'} dir="ltr" minLength={8} autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)}/>
                <button type="button" className="icon-button" onClick={() => setShow(v => !v)} aria-label={show ? a.hide : a.show}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
              </span>
              <span className="pw-meter"><span className={`pw-bars s${strength(newPw)}`} aria-hidden="true"><i/><i/><i/><i/></span><small>{newPw ? a.strength[strength(newPw)] : a.passwordHint}</small></span>
            </label>
            <label>{t.acc.confirm}
              <span className="auth-input"><Lock size={17}/><input required type={show ? 'text' : 'password'} dir="ltr" minLength={8} autoComplete="new-password" value={newPw2} onChange={e => setNewPw2(e.target.value)}/></span></label>
          </div>
          {message && <p className="auth-error" role="alert">{message}</p>}
          <button className="button primary auth-submit" type="submit" disabled={busy || resetCode.length !== 6 || newPw.length < 8 || !newPw2}>{busy ? a.working : t.reset.save}{!busy && <Go size={17}/>}</button>
          <div className="otp-links"><ResendButton key={sentAt} seconds={resetOtp.resendIn} onResend={resendReset} disabled={busy}/></div>
        </>}
        <p className="auth-switch"><button type="button" className="text-button" onClick={leaveReset}>{t.reset.back}</button></p>
        <p className="auth-local"><ShieldCheck size={15}/>{t.reset.note}</p>
      </form> : otp ? <form className="auth-card otp-card" onSubmit={e => { e.preventDefault(); verify(); }} noValidate>
        <span className="otp-icon" aria-hidden="true"><MailCheck size={26}/></span>
        <h2>{t.otp.loginTitle}</h2>
        <p className="auth-sub">{t.otp.sentTo} <b dir="ltr">{otp.email}</b></p>
        <div className="otp-field"><OtpInput value={code} onChange={setCode} onComplete={verify} disabled={busy} autoFocus/></div>
        {message && <p className="auth-error" role="alert">{message}</p>}
        <button className="button primary auth-submit" type="submit" disabled={busy || code.length !== 6}>{busy ? a.working : t.otp.verify}{!busy && <Go size={17}/>}</button>
        <div className="otp-links">
          <ResendButton key={sentAt} seconds={otp.resendIn} onResend={resend} disabled={busy}/>
          <button type="button" className="text-button" onClick={() => { setOtp(null); setError(''); setPassword(''); }}>{t.otp.back}</button>
        </div>
        <p className="auth-local"><ShieldCheck size={15}/>{t.otp.expires}</p>
      </form> : <form className="auth-card" onSubmit={submit} noValidate>
        {signup?.firstAccount && <div className="auth-tabs" role="tablist" aria-label={a.signIn}>
          <button type="button" role="tab" aria-selected={mode === 'in'} onClick={() => switchTo('in')}>{a.signIn}</button>
          <button type="button" role="tab" aria-selected={mode === 'up'} onClick={() => switchTo('up')}>{a.signUp}</button>
        </div>}
        <h2>{mode === 'in' ? a.welcome : a.join}</h2>
        <p className="auth-sub">{mode === 'in' ? a.welcomeSub : a.joinSub}</p>
        {notice && mode === 'in' && !error && <p className="auth-notice">{notice}</p>}

        <div className="auth-fields">
          {mode === 'up' && signup?.firstAccount && <p className="auth-notice first-note">{a.firstAccount}</p>}
          {mode === 'up' && <label>{a.name}
            <span className="auth-input"><UserIcon size={17}/><input required autoComplete="name" maxLength={80} value={name} onChange={e => setName(e.target.value)}/></span></label>}
          <label>{a.email}
            <span className="auth-input"><Mail size={17}/><input required type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)}/></span></label>
          <label>{a.password}
            <span className="auth-input"><Lock size={17}/>
              <input required type={show ? 'text' : 'password'} dir="ltr" minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                value={password} onChange={e => setPassword(e.target.value)} aria-describedby={mode === 'up' ? 'pw-hint' : undefined}/>
              <button type="button" className="icon-button" onClick={() => setShow(v => !v)} aria-label={show ? a.hide : a.show}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
            </span>
            {mode === 'in' && <button type="button" className="text-button forgot-link" onClick={() => { setForgot(true); setError(''); }}>{t.reset.link}</button>}
            {mode === 'up' && <span className="pw-meter" id="pw-hint">
              <span className={`pw-bars s${score}`} aria-hidden="true"><i/><i/><i/><i/></span>
              <small>{password ? a.strength[score] : a.passwordHint}</small>
            </span>}
          </label>
        </div>

        {message && <p className="auth-error" role="alert">{message}</p>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>
          {busy ? a.working : mode === 'in' ? a.submitIn : a.submitUp}{!busy && <Go size={17}/>}
        </button>
        <p className="auth-local"><ShieldCheck size={15}/>{a.local}</p>
      </form>}
      <p className="auth-credit auth-credit-small">{t.designedBy} <b lang="en">{student}</b> · Universiti Sains Malaysia</p>
    </main>
  </div></TooltipProvider>;
}
