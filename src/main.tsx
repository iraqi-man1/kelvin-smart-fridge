import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App, { APP_NAME, STUDENT } from './App';
import { api, type Prefs, type User } from './accountApi';
import { loadSettings } from './data';
import { AuthScreen } from './Auth';
import { defaultLockPrefs, loadLockPrefs, LockScreen, sanitizeLockPrefs, useAutoLock, type LockPrefs } from './LockScreen';
import type { Lang } from './types';
import { dictionaries, I18n, useLangState } from './i18n';
import './styles.css';

function Root() {
  const [lang, setLang] = useLangState();
  const t = dictionaries[lang];
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [notice, setNotice] = useState<'expired' | string>('');
  const [locked, setLocked] = useState(false);
  const [lockPrefs, setLockPrefsState] = useState<LockPrefs>(defaultLockPrefs);

  /** Saves part of the preferences on the server, under this account. */
  const savePrefs = (patch: Prefs) => { api.savePrefs(patch).then(setUser).catch(() => {}); };
  const setLockPrefs = (p: LockPrefs) => { setLockPrefsState(p); savePrefs({ lock: p }); };
  const changeLang = (l: Lang) => { setLang(l); if (user) savePrefs({ lang: l }); };

  /** A signed-in user brings their saved preferences; the first time, this browser's old ones move to the account. */
  function arrive(u: User, wasLocked = false) {
    let prefs = u.prefs ?? {};
    if (!Object.keys(prefs).length) {
      const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
      prefs = {
        settings: loadSettings(), lock: loadLockPrefs(), lang,
        theme: read('kelvin-theme') === 'light' ? 'light' : 'dark', mode: read('kelvin-mode') === 'live' ? 'live' : 'demo',
      };
      api.savePrefs(prefs).catch(() => {});
      for (const k of ['kelvin-settings', 'kelvin-lock', 'kelvin-mode']) try { localStorage.removeItem(k); } catch {}
      u = { ...u, prefs };
    }
    // The theme and language also stay cached in the browser, so the sign-in page opens in them.
    if (prefs.theme) { document.documentElement.dataset.theme = prefs.theme; try { localStorage.setItem('kelvin-theme', prefs.theme); } catch {} }
    if (prefs.lang && prefs.lang !== lang) setLang(prefs.lang);
    setLockPrefsState(sanitizeLockPrefs(prefs.lock));
    setLocked(wasLocked);
    setUser(u);
  }

  useEffect(() => { api.me().then(b => arrive(b.user, b.locked)).catch(() => setUser(null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The server keeps the lock too, so a refresh or another tab cannot skip it.
  const lock = () => { setLocked(true); api.lock().catch(() => {}); };
  useAutoLock(Boolean(user) && !locked, lockPrefs, lock);
  const signOut = (message: string) => { setNotice(message); setLocked(false); setUser(null); };

  // Any dashboard request answered 401 means the session ended (expired, or signed out elsewhere).
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (res.status === 401 && url.includes('/api/') && !url.includes('/api/auth/') && !url.endsWith('/api/me')) {
        setNotice('expired'); setUser(null);
      }
      if (res.status === 423) setLocked(true); // locked from another tab
      return res;
    };
    return () => { window.fetch = original; };
  }, []);

  if (user === undefined) return <div className="boot" aria-busy="true"/>;
  return <I18n.Provider value={{ lang, t }}>
    {user && locked && <LockScreen user={user} setLang={changeLang} onUnlocked={() => setLocked(false)} onSignOut={() => api.logout().finally(() => signOut(''))}/>}
    {user
      // While locked the dashboard stays mounted (it keeps its data) but hidden and unreachable.
      ? <div hidden={locked} inert={locked}><App key={user.id} user={user} onUser={setUser} onSignedOut={signOut} lang={lang} setLang={changeLang}
          onLock={lock} lockPrefs={lockPrefs} setLockPrefs={setLockPrefs} savePrefs={savePrefs}/></div>
      : <AuthScreen app={APP_NAME} student={STUDENT} setLang={setLang} notice={notice === 'expired' ? t.auth.expired : notice}
          onSignedIn={u => { setNotice(''); arrive(u); }}/>}
  </I18n.Provider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
