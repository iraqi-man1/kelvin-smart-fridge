import { useEffect, useState, type ReactNode } from 'react';
import { Cpu, Database, LayoutDashboard, Mail, Send, Server, Thermometer } from 'lucide-react';
import type { User } from './accountApi';
import { useT } from './i18n';

type Info = {
  hosting?: 'netlify' | 'vercel' | 'local';
  storage?: { kind: string; label: string; readings: number };
  system?: { deviceProtected: boolean; deviceLastSeen: number | null; lastReading: number | null; telegram: boolean; email: boolean; node: string };
};

function Node({ icon, title, sub, status, ok, id }: { icon: ReactNode; title: string; sub: string; status: string; ok: boolean; id: string }) {
  return <article className={`sys-node sys-${id}`}>
    <span className="sys-icon" aria-hidden="true">{icon}</span>
    <h3>{title}</h3>
    <p className="sys-sub">{sub}</p>
    <p className={`sys-status ${ok ? 'ok' : 'off'}`}><i aria-hidden="true"/>{status}</p>
  </article>;
}

/** A connector with dots travelling along it; `back` runs the other way. */
const Link = ({ label, back, vertical }: { label: string; back?: boolean; vertical?: boolean }) =>
  <div className={`sys-link ${back ? 'back' : ''} ${vertical ? 'vertical' : ''}`} aria-hidden="true">
    <span className="sys-line"><i/><i/><i/></span><small>{label}</small>
  </div>;

export function SystemPage({ user, mode }: { user: User; mode: 'demo' | 'live' }) {
  const { t } = useT();
  const s = t.sys;
  const [info, setInfo] = useState<Info>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => fetch('/api/info').then(r => r.ok ? r.json() : null).then(v => { if (v) setInfo(v); setNow(Date.now()); }).catch(() => {});
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(id);
  }, []);
  const sys = info.system;
  const ago = (ts: number | null | undefined) => ts ? t.ago(Math.max(0, Math.round((now - ts) / 1000))) : null;
  const lastReading = ago(sys?.lastReading);
  const n = s.nodes;

  return <>
    <section className="panel sys-diagram" aria-label={t.pages.system[0]}>
      <div className="sys-row">
        <Node id="sensors" icon={<Thermometer size={22}/>} title={n.sensors[0]} sub={n.sensors[1]} ok={Boolean(lastReading)} status={lastReading ? s.live(lastReading) : s.waiting}/>
        <Link label={s.links.wires}/>
        <Node id="esp32" icon={<Cpu size={22}/>} title={n.esp32[0]} sub={n.esp32[1]} ok={Boolean(sys?.deviceProtected)} status={sys?.deviceProtected ? s.keyOn : s.keyOff}/>
        <div className="sys-pair"><Link label={s.links.http}/><Link label={s.links.back} back/></div>
        <Node id="server" icon={<Server size={22}/>} title={n.server[0]} sub={info.hosting === 'vercel' ? n.serverCloud[1].replace('Netlify', 'Vercel') : info.hosting === 'netlify' ? n.serverCloud[1] : n.server[1]} ok status={s.running((sys?.node ?? '').replace(/^v(\d+).*/, '$1'))}/>
        <Link label={s.links.sql}/>
        <Node id="db" icon={<Database size={22}/>} title={n.db[0]} sub={info.storage?.kind === 'postgres' ? n.db[1] : s.files}
          ok={info.storage?.kind === 'postgres'} status={info.storage ? s.rows(info.storage.readings.toLocaleString('en-US')) : '…'}/>
      </div>
      <div className="sys-branch" aria-hidden="true"><span/></div>
      <div className="sys-outputs">
        <div><Link label={s.links.web} vertical/><Node id="dash" icon={<LayoutDashboard size={22}/>} title={n.dash[0]} sub={n.dash[1]} ok status={s.you(t.roles[user.role])}/></div>
        <div><Link label={s.links.bot} vertical/><Node id="telegram" icon={<Send size={22}/>} title={n.telegram[0]} sub={n.telegram[1]} ok={Boolean(sys?.telegram)} status={sys?.telegram ? s.on : s.off}/></div>
        <div><Link label={s.links.smtp} vertical/><Node id="email" icon={<Mail size={22}/>} title={n.email[0]} sub={n.email[1]} ok={Boolean(sys?.email)} status={sys?.email ? s.on : s.off}/></div>
      </div>
      {mode === 'demo' && <p className="footnote sys-demo">{t.ctl.demoNote}</p>}
    </section>

    <div className="grid">
      <section className="panel span-2">
        <header className="panel-head"><div><h2>{s.stepsTitle}</h2></div></header>
        <ol className="sys-steps">{s.steps.map((step, i) => <li key={i}><span className="step-num mono">{i + 1}</span><p>{step}</p></li>)}</ol>
      </section>
      <section className="panel">
        <header className="panel-head"><div><h2>{s.secTitle}</h2></div></header>
        <ul className="check-list sys-sec">{s.sec.map(x => <li key={x}>{x}</li>)}</ul>
        <h3 className="sub-head">{s.stackTitle}</h3>
        <div className="sys-stack" dir="ltr">{['ESP32 · Arduino', 'DHT11', 'CCS811', 'SSD1306 OLED', 'Node.js', 'React', 'TypeScript', 'Vite', 'Supabase', 'PostgreSQL', 'Telegram Bot API', 'Gmail SMTP'].map(x => <span key={x} className="tag">{x}</span>)}</div>
      </section>
    </div>
  </>;
}
