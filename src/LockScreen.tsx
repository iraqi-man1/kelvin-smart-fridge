import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ChevronUp, KeyRound, Lock, LogOut, RectangleEllipsis } from 'lucide-react';
import { Avatar } from './Account';
import { api, type User } from './accountApi';
import { dictionaries, langs, useT } from './i18n';
import type { Lang } from './types';

export type LockPrefs = { hidden: 'never' | 'now' | '10' | '60'; idle: 0 | 1 | 5 | 15 | 30 };
const PREFS_KEY = 'kelvin-lock';
export const defaultLockPrefs: LockPrefs = { hidden: '10', idle: 0 };

/** Lock settings saved in this browser before they moved to the account (read once, to carry them over). */
export function loadLockPrefs(): LockPrefs {
  try { return sanitizeLockPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { return defaultLockPrefs; }
}
export function sanitizeLockPrefs(p: unknown): LockPrefs {
  const v = (p && typeof p === 'object' ? p : {}) as Partial<LockPrefs>;
  return {
    hidden: (['never', 'now', '10', '60'] as const).includes(v.hidden as LockPrefs['hidden']) ? v.hidden as LockPrefs['hidden'] : defaultLockPrefs.hidden,
    idle: ([0, 1, 5, 15, 30] as const).includes(v.idle as LockPrefs['idle']) ? v.idle as LockPrefs['idle'] : defaultLockPrefs.idle,
  };
}

const isLockKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l';

/**
 * Locks the dashboard the ways Windows does: a shortcut (Ctrl+Shift+L), the
 * window being hidden (Win+L, minimise, another tab) and no activity for a while.
 * A web page never receives Win+L itself, so the hidden window is how it follows Windows.
 */
export function useAutoLock(active: boolean, prefs: LockPrefs, lock: () => void) {
  const lockRef = useRef(lock);
  lockRef.current = lock;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (isLockKey(e)) { e.preventDefault(); lockRef.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    if (!active || prefs.hidden === 'never') return;
    const delay = prefs.hidden === 'now' ? 0 : Number(prefs.hidden) * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Repeated "hidden" events must not restart the countdown.
        if (hiddenAt) return;
        hiddenAt = Date.now();
        if (!delay) lockRef.current();
        else timer = setTimeout(() => lockRef.current(), delay);
      } else {
        clearTimeout(timer);
        // Browsers hold back timers in hidden pages, so check again on the way back.
        if (hiddenAt && Date.now() - hiddenAt >= delay) lockRef.current();
        hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [active, prefs.hidden]);

  useEffect(() => {
    if (!active || !prefs.idle) return;
    let last = Date.now();
    const seen = () => { last = Date.now(); };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, seen, { passive: true }));
    const id = setInterval(() => { if (Date.now() - last >= prefs.idle * 60000) lockRef.current(); }, 5000);
    return () => { clearInterval(id); events.forEach(e => window.removeEventListener(e, seen)); };
  }, [active, prefs.idle]);
}

type Props = { user: User; onUnlocked: () => void; onSignOut: () => void; setLang: (l: Lang) => void };

export function LockScreen({ user, onUnlocked, onSignOut, setLang }: Props) {
  const { t, lang } = useT();
  const l = t.lock;
  const [now, setNow] = useState(new Date());
  const [phase, setPhase] = useState<'clock' | 'signin'>('clock');
  // With a PIN set it is asked first; the account password is the other sign-in option.
  const [method, setMethod] = useState<'code' | 'password'>(user.hasLockCode ? 'code' : 'password');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const Go = t.dir === 'rtl' ? ArrowLeft : ArrowRight;
  const tab = phase === 'signin' ? 0 : -1;

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);

  // Like Windows: any key or click lifts the clock and shows the sign-in.
  useEffect(() => {
    if (phase !== 'clock') return;
    const open = (e: KeyboardEvent | PointerEvent) => {
      if (e instanceof KeyboardEvent && (e.key === 'Tab' || e.key === 'Shift' || isLockKey(e))) return;
      if (e.target instanceof Element && e.target.closest('.lock-bar')) return;
      setPhase('signin');
    };
    window.addEventListener('keydown', open);
    window.addEventListener('pointerdown', open);
    return () => { window.removeEventListener('keydown', open); window.removeEventListener('pointerdown', open); };
  }, [phase]);

  // Back to the clock after 30 s untouched, or on Escape.
  useEffect(() => {
    if (phase !== 'signin') return;
    // After the click's own focus handling, so the cursor lands in the box.
    const focus = setTimeout(() => input.current?.focus(), 60);
    const back = () => { setPhase('clock'); setSecret(''); setError(''); };
    let id = setTimeout(back, 30000);
    const reset = (e: Event) => { clearTimeout(id); if (e instanceof KeyboardEvent && e.key === 'Escape') back(); else id = setTimeout(back, 30000); };
    window.addEventListener('keydown', reset);
    window.addEventListener('pointerdown', reset);
    return () => { clearTimeout(focus); clearTimeout(id); window.removeEventListener('keydown', reset); window.removeEventListener('pointerdown', reset); };
  }, [phase]);

  function choose(m: 'code' | 'password') { setMethod(m); setSecret(''); setError(''); setTimeout(() => input.current?.focus(), 0); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!secret) return;
    setBusy(true); setError('');
    try { await api.unlock(method, secret); onUnlocked(); }
    catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code === 'wrong-code' ? l.wrongPin : code === 'wrong-password' ? l.wrong : t.auth.errors[code] ?? t.auth.errors['request-failed']);
      setSecret('');
      setTimeout(() => input.current?.focus(), 0);
    } finally { setBusy(false); }
  }

  const locale = lang === 'ar' ? 'ar' : lang === 'ms' ? 'ms-MY' : 'en-GB';
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', numberingSystem: 'latn' }).format(now);
  const label = method === 'code' ? l.pin : t.auth.password;

  return <div className={`lock-screen ${phase}`} role="dialog" aria-modal="true" aria-label={l.title}>
    <div className="lock-bg" aria-hidden="true"><i/><i/><i/></div>

    <header className="lock-top">
      <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true"/><span lang="en">Kelvin</span>
    </header>

    <div className="lock-clock" aria-hidden={phase !== 'clock'}>
      <time className="lock-time" dir="ltr">{time}</time>
      <p className="lock-date">{date}</p>
    </div>
    <p className="lock-hint" aria-hidden={phase !== 'clock'}><ChevronUp size={16}/>{l.hint}</p>

    <form className="lock-signin" onSubmit={submit} aria-hidden={phase !== 'signin'}>
      <span className="lock-avatar"><Avatar user={user} size={120}/></span>
      <h1>{user.name}</h1>
      <p className="lock-email blurred" dir="ltr" aria-hidden="true">{user.email}</p>
      <div className={`lock-field ${error ? 'has-error' : ''}`}>
        <input ref={input} type="password" dir="ltr" autoComplete={method === 'code' ? 'off' : 'current-password'} placeholder={label} aria-label={label}
          value={secret} onChange={e => setSecret(e.target.value)} tabIndex={tab} disabled={busy}
          onKeyDown={e => setCaps(e.getModifierState('CapsLock'))} onKeyUp={e => setCaps(e.getModifierState('CapsLock'))}/>
        <button type="submit" aria-label={l.unlock} disabled={busy || !secret} tabIndex={tab}><Go size={18}/></button>
      </div>
      <p className="lock-error" role="alert">{error || (caps ? l.caps : '')}</p>
      {user.hasLockCode && <div className="lock-options">
        <span>{l.options}</span>
        <div role="group" aria-label={l.options}>
          <button type="button" aria-pressed={method === 'code'} onClick={() => choose('code')} title={l.usePin} aria-label={l.usePin} tabIndex={tab}><RectangleEllipsis size={18}/></button>
          <button type="button" aria-pressed={method === 'password'} onClick={() => choose('password')} title={l.usePassword} aria-label={l.usePassword} tabIndex={tab}><KeyRound size={18}/></button>
        </div>
      </div>}
    </form>

    <footer className="lock-bar">
      <button type="button" className="lock-bar-button" onClick={onSignOut}><LogOut size={16}/>{l.other}</button>
      <div className="lock-langs" role="group" aria-label={t.language}>
        {langs.map(([code, short]) => <button key={code} type="button" lang={code} aria-pressed={lang === code} title={dictionaries[code].langName} onClick={() => setLang(code)}>{short}</button>)}
      </div>
      <span className="lock-state"><Lock size={14}/>{l.title}</span>
    </footer>
  </div>;
}
