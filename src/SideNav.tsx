import { useEffect, useState, type ComponentType } from 'react';
import { Bell, BookOpen, ChevronDown, Cpu, LayoutGrid, LifeBuoy, List, MonitorSmartphone, PlugZap, Send, ShieldCheck, Users, Workflow, Zap, CircleHelp } from 'lucide-react';
import { useT } from './i18n';
import type { Page } from './types';

type Icon = ComponentType<{ size?: number }>;
type Group = { id: 'monitor' | 'device' | 'admin' | 'help'; icon: Icon; items: [Page, Icon][] };

const KEY = 'kelvin-nav-open';
const readOpen = (): string[] | null => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };

/**
 * The side menu as a tree: each group opens to show its pages on a branch line.
 * The group holding the current page always stays open; the rest remember their state.
 */
export function SideNav({ page, admin, unread, onGo }: { page: Page; admin: boolean; unread: number; onGo: (p: Page) => void }) {
  const { t } = useT();
  const groups: Group[] = [
    { id: 'monitor', icon: LayoutGrid, items: [['overview', LayoutGrid], ['energy', Zap], ['sensors', Cpu], ['history', List], ['alerts', Bell]] },
    { id: 'device', icon: MonitorSmartphone, items: [['connect', PlugZap]] },
    ...(admin ? [{ id: 'admin', icon: ShieldCheck, items: [['users', Users], ['telegram', Send]] } as Group] : []),
    { id: 'help', icon: CircleHelp, items: [['system', Workflow], ['guide', BookOpen], ['support', LifeBuoy]] },
  ];
  const holding = groups.find(g => g.items.some(([id]) => id === page))?.id;
  const [open, setOpen] = useState<string[]>(() => readOpen() ?? ['monitor']);
  // Arriving on a page (from a button elsewhere) opens its group.
  useEffect(() => { if (holding && !open.includes(holding)) setOpen(o => [...o, holding]); }, [holding]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(open)); } catch { /* private mode: just not remembered */ } }, [open]);

  const toggle = (id: string) => setOpen(o => o.includes(id) ? o.filter(x => x !== id) : [...o, id]);

  return <nav className="side-nav" aria-label={t.navGroups.label}>{groups.map(g => {
    const isOpen = open.includes(g.id);
    const count = g.items.some(([id]) => id === 'alerts') ? unread : 0;
    return <div key={g.id} className={`nav-tree ${isOpen ? 'open' : ''} ${holding === g.id ? 'holding' : ''}`}>
      <button className="nav-item nav-head" aria-expanded={isOpen} aria-controls={`nav-${g.id}`} onClick={() => toggle(g.id)}>
        <g.icon size={18}/><span>{t.navGroups[g.id]}</span>
        {!isOpen && count > 0 && <span className="nav-count">{count}</span>}
        <ChevronDown size={16} className="nav-chevron"/>
      </button>
      <ul id={`nav-${g.id}`} className="nav-branch" hidden={!isOpen}>{g.items.map(([id, Icon]) => <li key={id}>
        <button onClick={() => onGo(id)} className={`nav-item nav-sub ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined}>
          <Icon size={16}/><span>{t.nav[id]}</span>{id === 'alerts' && unread > 0 && <span className="nav-count">{unread}</span>}
        </button>
      </li>)}</ul>
    </div>;
  })}</nav>;
}
