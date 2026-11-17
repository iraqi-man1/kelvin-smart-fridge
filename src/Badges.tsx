import { useEffect, useState, type ReactNode } from 'react';
import { Award, CalendarCheck, Camera, Crown, FileSpreadsheet, Flame, LifeBuoy, Lock, Radio, ShieldCheck, Sparkles, Sprout, Trophy } from 'lucide-react';
import { api, type Activity, type User } from './accountApi';
import { useT } from './i18n';

type BadgeId = 'welcome' | 'regular' | 'dedicated' | 'veteran' | 'streak3' | 'streak7' | 'month' | 'secure' | 'guarded' | 'portrait' | 'analyst' | 'commander' | 'helper';

/** Each badge: its icon, and how far along the person is (value of target). */
const BADGES: { id: BadgeId; icon: ReactNode; progress: (a: Activity, u: User) => [number, number] }[] = [
  { id: 'welcome', icon: <Sprout size={22}/>, progress: a => [Math.min(a.activeDays, 1), 1] },
  { id: 'regular', icon: <CalendarCheck size={22}/>, progress: a => [a.activeDays, 3] },
  { id: 'dedicated', icon: <Award size={22}/>, progress: a => [a.activeDays, 7] },
  { id: 'veteran', icon: <Crown size={22}/>, progress: a => [a.activeDays, 30] },
  { id: 'streak3', icon: <Flame size={22}/>, progress: a => [a.bestStreak, 3] },
  { id: 'streak7', icon: <Trophy size={22}/>, progress: a => [a.bestStreak, 7] },
  { id: 'month', icon: <Sparkles size={22}/>, progress: a => [a.memberDays, 30] },
  { id: 'secure', icon: <ShieldCheck size={22}/>, progress: (_, u) => [u.otpEmail ? 1 : 0, 1] },
  { id: 'guarded', icon: <Lock size={22}/>, progress: (_, u) => [u.hasLockCode ? 1 : 0, 1] },
  { id: 'portrait', icon: <Camera size={22}/>, progress: (_, u) => [u.avatar ? 1 : 0, 1] },
  { id: 'analyst', icon: <FileSpreadsheet size={22}/>, progress: a => [a.exports, 1] },
  { id: 'commander', icon: <Radio size={22}/>, progress: a => [a.commands, 1] },
  { id: 'helper', icon: <LifeBuoy size={22}/>, progress: a => [a.reports, 1] },
];

/** Badges and usage numbers on the account page, to make using Kelvin a little more fun. */
export function Badges({ user }: { user: User }) {
  const { t } = useT();
  const b = t.badges;
  const [stats, setStats] = useState<Activity | null>(null);
  useEffect(() => { api.activity().then(setStats).catch(() => {}); }, [user.otpEmail, user.hasLockCode, user.avatar]);

  if (!stats) return <section className="panel span-all badges-panel"><header className="panel-head"><div><h2>{b.title}</h2><p>{b.loading}</p></div></header></section>;

  const list = BADGES.map(x => { const [v, target] = x.progress(stats, user); return { ...x, value: Math.min(v, target), target, earned: v >= target }; });
  const earned = list.filter(x => x.earned).length;
  // Earned first, then the closest to being earned.
  list.sort((x, y) => Number(y.earned) - Number(x.earned) || y.value / y.target - x.value / x.target);

  const tiles: [string, number, string][] = [
    [b.memberDays, stats.memberDays, b.days(stats.memberDays)],
    [b.activeDays, stats.activeDays, b.days(stats.activeDays)],
    [b.streak, stats.streak, b.streakUnit(stats.streak)],
    [b.logins, stats.logins, b.times(stats.logins)],
  ];

  return <section className="panel span-all badges-panel">
    <header className="panel-head">
      <div><h2>{b.title}</h2><p>{b.sub}</p></div>
      <span className="badge-score" aria-label={b.score(earned, list.length)}><Trophy size={14} aria-hidden="true"/>{earned} / {list.length}</span>
    </header>
    <div className="usage-tiles">{tiles.map(([label, n, unit]) => <div key={label} className="usage-tile">
      <small>{label}</small><b className="mono">{n}</b><span>{unit}</span>
    </div>)}</div>
    <ul className="badge-grid">{list.map(x => <li key={x.id} className={`badge ${x.earned ? 'earned' : ''} badge-${x.id}`}>
      <span className="badge-icon" aria-hidden="true">{x.icon}</span>
      <div className="badge-text">
        <b>{b.names[x.id]}</b>
        <small>{b.how[x.id]}</small>
        {x.earned
          ? <span className="badge-state">{b.earned}</span>
          : <span className="badge-progress" aria-label={b.progress(x.value, x.target)}><span className="duty-track"><span style={{ width: `${Math.round(x.value / x.target * 100)}%` }}/></span><small className="mono">{x.value}/{x.target}</small></span>}
      </div>
    </li>)}</ul>
  </section>;
}
