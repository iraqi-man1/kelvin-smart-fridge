import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { niceStep } from './Charts';
import { CHECK_IN_SECONDS, currencies, formatEnergy, formatMoney, formatUptime, shortTime } from './data';
import { useT } from './i18n';
import { currentNow, hourlyWh, parts, totalWh, usageBetween } from './power';
import type { Reading, Settings } from './types';

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Wh used in each of the last 24 clock hours; the running hour is drawn lighter. */
function HourlyBars({ hours }: { hours: ReturnType<typeof hourlyWh> }) {
  const { t } = useT();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const h = 170, top = 8, bottom = h - 2, padL = 46, padR = 14, plotW = width - padL - padR;
  const peak = Math.max(...hours.map(b => b.wh)) * 1.1 || 1;
  const step = niceStep(peak, 3), max = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => +(i * step).toFixed(3));
  const slot = plotW / hours.length, gap = Math.min(4, slot * 0.25);
  const y = (v: number) => bottom - v / max * (bottom - top);
  const shown = hours[hover ?? hours.length - 1];
  const total = formatEnergy(hours.reduce((s, b) => s + b.wh, 0));

  return <div className="hour-bars" ref={ref} onPointerLeave={() => setHover(null)}>
    <div className="power-readout" dir={t.dir}>
      <span>{hover === null ? t.e.thisHour : t.e.hour} <b className="mono" dir="ltr">{shortTime(shown.start)}–{shortTime(shown.start + 3600000)}</b></span>
      <span><b className="mono" dir="ltr">{shown.wh.toFixed(2)}</b> Wh</span>
      <span>{t.e.onMin(Math.round(shown.hours * 60))}</span>
      <span className="muted">{t.e.total} <b className="mono" dir="ltr">{total.value}</b> {total.unit}</span>
    </div>
    <svg width={width} height={h} role="img" aria-label={t.e.hourlyAria(`${total.value} ${total.unit}`)}>
      {ticks.map(v => <g key={v}>
        <line className="grid" x1={padL} x2={width - padR} y1={y(v)} y2={y(v)}/>
        <text className="tick" x={padL - 8} y={y(v) + 4} textAnchor="end">{v}</text>
      </g>)}
      {hours.map((b, i) => <rect key={b.start} x={padL + i * slot + gap / 2} width={Math.max(1, slot - gap)}
        y={y(b.wh)} height={Math.max(0, bottom - y(b.wh))} rx="2"
        className={`hour-bar ${b.current ? 'current' : ''} ${hover === i ? 'active' : ''}`}
        onPointerEnter={() => setHover(i)}><title>{`${shortTime(b.start)} · ${b.wh.toFixed(2)} Wh`}</title></rect>)}
    </svg>
    <svg className="strip-axis" width={width} height={22} aria-hidden="true">
      {hours.map((b, i) => new Date(b.start).getHours() % (slot * 3 < 44 ? 6 : 3) === 0 && <g key={b.start}>
        <line x1={padL + i * slot} x2={padL + i * slot} y1={0} y2={5}/>
        <text x={padL + i * slot} y={17} textAnchor="middle">{shortTime(b.start)}</text>
      </g>)}
    </svg>
  </div>;
}

export function useEnergy(readings: Reading[], settings: Settings, now: number) {
  return useMemo(() => {
    const V = settings.supplyVoltage;
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const today = usageBetween(readings, midnight.getTime(), now, settings);
    const day = usageBetween(readings, now - 86400000, now, settings);
    const todayWh = totalWh(today, V), dayWh = totalWh(day, V);
    const interval = CHECK_IN_SECONDS;
    const latest = readings.at(-1);
    const live = currentNow(latest, interval, settings);
    const mA = live.reduce((s, p) => s + p.mA, 0);
    const averageW = day.hours >= 0.25 ? dayWh / day.hours : mA * V / 1000;
    const monthKwh = averageW * 24 * 30 / 1000;
    return {
      hasData: readings.length > 1, latest, interval, live, mA, watts: mA * V / 1000,
      today, todayWh, todayCost: todayWh / 1000 * settings.tariff,
      day, dayWh, averageW, monthKwh, monthCost: monthKwh * settings.tariff,
      sinceBootWh: latest?.uptime !== undefined ? averageW * latest.uptime / 3600 : undefined,
    };
  }, [readings, settings, now]);
}

type Props = { readings: Reading[]; settings: Settings; now: number; onSettings: () => void };

export function EnergyPage({ readings, settings, now, onSettings }: Props) {
  const { t, lang } = useT();
  const cur = currencies[settings.currency].symbol(lang);
  const e = useEnergy(readings, settings, now);
  const hours = useMemo(() => hourlyWh(readings, now, settings), [readings, now, settings]);
  const V = settings.supplyVoltage;

  if (!e.hasData) return <div className="grid"><section className="panel span-all empty-state energy-empty">
    <h3>{t.e.waitTitle}</h3><p>{t.e.waitText}</p>
  </section></div>;

  const today = formatEnergy(e.todayWh), boot = formatEnergy(e.sinceBootWh);
  const enabled = parts.filter(p => settings.parts.includes(p.id));
  const off = parts.filter(p => !settings.parts.includes(p.id));
  const rows = enabled.map(p => {
    const wh = e.day.mAh[p.id] * V / 1000;
    return { p, wh, share: e.dayWh ? wh / e.dayWh : 0, avg: e.day.hours ? e.day.mAh[p.id] / e.day.hours : 0, now: e.live.find(l => l.part.id === p.id)!.mA };
  }).sort((a, b) => b.wh - a.wh);
  const mA = (v: number) => v >= 10 ? v.toFixed(0) : v >= 0.1 ? v.toFixed(1) : v.toFixed(3);
  const money = (v: number) => <b className="mono" dir="ltr">{formatMoney(v)} {cur}</b>;

  return <>
    <div className="readouts energy-readouts">
      <article className="metric-card">
        <header><span className="swatch power-swatch"/><h2>{t.e.powerNow}</h2><span className="source mono" dir="ltr">{V} V</span></header>
        <div className="metric-value" dir="ltr"><strong className="mono">{e.watts.toFixed(2)}</strong><span>W</span></div>
        <div className="metric-meta"><span>{t.e.current} <b className="mono" dir="ltr">{e.mA.toFixed(0)} mA</b></span></div>
      </article>
      <article className="metric-card">
        <header><h2>{t.e.today}</h2><span className="source mono">00:00 →</span></header>
        <div className="metric-value" dir="ltr"><strong className="mono">{today.value}</strong><span>{today.unit}</span></div>
        <div className="metric-meta"><span>{t.e.onFor(e.today.hours.toFixed(1))} · ≈ {money(e.todayCost)}</span></div>
      </article>
      <article className="metric-card">
        <header><h2>{t.e.boot}</h2><span className="source mono" dir="ltr">{formatUptime(e.latest?.uptime)}</span></header>
        <div className="metric-value" dir="ltr"><strong className="mono">{boot.value}</strong><span>{boot.unit}</span></div>
        <div className="metric-meta"><span>{e.sinceBootWh === undefined ? t.e.noUptime : t.e.fromUptime}</span></div>
      </article>
      <article className="metric-card">
        <header><h2>{t.e.month}</h2><span className="source mono" dir="ltr">{settings.tariff} {cur}/kWh</span></header>
        <div className="metric-value" dir="ltr"><strong className="mono">{e.monthKwh.toFixed(2)}</strong><span>kWh</span></div>
        <div className="metric-meta"><span>≈ {money(e.monthCost)} · {t.e.atAvg} <b className="mono" dir="ltr">{e.averageW.toFixed(2)} W</b></span></div>
      </article>
    </div>

    <div className="grid">
      <section className="panel span-all breakdown-panel">
        <header className="panel-head">
          <div><h2>{t.e.breakdown}</h2><p>{t.e.breakdownSub(e.day.hours.toFixed(1), e.day.sends.toLocaleString('en-US'))}</p></div>
          <button className="button" onClick={onSettings}><Settings2 size={16}/>{t.e.editParts}</button>
        </header>
        <div className="table-scroll"><table className="breakdown">
          <thead><tr>
            <th>{t.e.part}</th><th>{t.e.when}</th><th className="num">{t.e.now} <span dir="ltr">(mA)</span></th>
            <th className="num">{t.e.avg} <span dir="ltr">(mA)</span></th><th className="num">{t.e.energy} <span dir="ltr">(Wh)</span></th><th className="share-col">{t.e.share}</th>
          </tr></thead>
          <tbody>{rows.map(r => <tr key={r.p.id}>
            <td><b>{t.parts[r.p.id].name}</b><small>{t.parts[r.p.id].role}</small></td>
            <td><span className={`kind ${r.p.kind}`}>{t.e.kind[r.p.kind]}</span></td>
            <td className="num"><span dir="ltr">{mA(r.now)}</span></td>
            <td className="num"><span dir="ltr">{mA(r.avg)}</span></td>
            <td className="num"><span dir="ltr">{r.wh.toFixed(r.wh < 0.1 ? 3 : 2)}</span></td>
            <td className="share-col"><div className="share" dir="ltr"><span className="share-track"><i style={{ width: `${r.share * 100}%` }}/></span><span className="mono">{(r.share * 100).toFixed(r.share < 0.01 ? 1 : 0)}%</span></div></td>
          </tr>)}</tbody>
          <tfoot><tr>
            <th scope="row">{t.e.total}</th><td/>
            <td className="num"><span dir="ltr">{e.mA.toFixed(0)}</span></td>
            <td className="num"><span dir="ltr">{e.day.hours ? (e.averageW / V * 1000).toFixed(0) : '—'}</span></td>
            <td className="num"><span dir="ltr">{e.dayWh.toFixed(2)}</span></td><td className="share-col"/>
          </tr></tfoot>
        </table></div>
        {off.length > 0 && <p className="footnote parts-off">{t.e.off(off.map(p => t.parts[p.id].name).join(t.dir === 'rtl' ? '، ' : ', '))}</p>}
      </section>

      <section className="panel span-2">
        <header className="panel-head"><div><h2>{t.e.hourly}</h2><p>{t.e.hourlySub}</p></div></header>
        <HourlyBars hours={hours}/>
      </section>

      <section className="panel method-panel">
        <header className="panel-head"><div><h2>{t.e.method}</h2><p>{t.e.methodSub}</p></div></header>
        <p className="formula" dir="ltr">E = V × I × t</p>
        <dl className="spec-list">
          <div><dt>{t.e.supply}</dt><dd className="mono" dir="ltr">{V} V (USB)</dd></div>
          <div><dt>{t.e.interval}</dt><dd className="mono" dir="ltr">{e.interval.toFixed(e.interval < 10 ? 1 : 0)} s</dd></div>
          <div><dt>{t.e.alertTime}</dt><dd className="mono" dir="ltr">{Math.round(e.day.alertHours * 60)} min</dd></div>
        </dl>
        <p className="footnote method-note">{t.e.methodNote}</p>
        <details className="sources"><summary>{t.e.sources}</summary>
          <ul>{enabled.map(p => <li key={p.id}><b>{t.parts[p.id].name}</b> {t.parts[p.id].source}</li>)}</ul>
        </details>
      </section>
      <p className="footnote span-all">{t.e.footnote}</p>
    </div>
  </>;
}
