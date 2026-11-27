import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { niceStep } from './Charts';
import { CHECK_IN_SECONDS, currencies, formatCharge, formatEnergy, formatMoney, formatUptime, shortTime } from './data';
import { useT } from './i18n';
import { currentNow, hourlyWh, parts, totalWh, usageBetween } from './power';
import { Segmented } from './ui';
import type { Reading, Settings } from './types';

/** Energy in watt-hours, or charge in milliamp-hours (what a battery or power bank is rated in). */
type Unit = 'wh' | 'mah';
const UNIT_KEY = 'kelvin-energy-unit';
const storedUnit = (): Unit => { try { return localStorage.getItem(UNIT_KEY) === 'mah' ? 'mah' : 'wh'; } catch { return 'wh'; } };

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
function HourlyBars({ hours: whHours, unit, volts }: { hours: ReturnType<typeof hourlyWh>; unit: Unit; volts: number }) {
  const { t } = useT();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  // In mAh the bars show charge: Wh × 1000 ÷ V.
  const hours = unit === 'mah' ? whHours.map(b => ({ ...b, wh: b.wh * 1000 / volts })) : whHours;
  const label = unit === 'mah' ? 'mAh' : 'Wh';
  const h = 170, top = 8, bottom = h - 2, padL = 46, padR = 14, plotW = width - padL - padR;
  const peak = Math.max(...hours.map(b => b.wh)) * 1.1 || 1;
  const step = niceStep(peak, 3), max = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => +(i * step).toFixed(3));
  const slot = plotW / hours.length, gap = Math.min(4, slot * 0.25);
  const y = (v: number) => bottom - v / max * (bottom - top);
  const shown = hours[hover ?? hours.length - 1];
  const sum = hours.reduce((s, b) => s + b.wh, 0);
  const total = unit === 'mah' ? formatCharge(sum) : formatEnergy(sum);

  return <div className="hour-bars" ref={ref} onPointerLeave={() => setHover(null)}>
    <div className="power-readout" dir={t.dir}>
      <span>{hover === null ? t.e.thisHour : t.e.hour} <b className="mono" dir="ltr">{shortTime(shown.start)}–{shortTime(shown.start + 3600000)}</b></span>
      <span><b className="mono" dir="ltr">{shown.wh.toFixed(unit === 'mah' ? 1 : 2)}</b> {label}</span>
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
        onPointerEnter={() => setHover(i)}><title>{`${shortTime(b.start)} · ${b.wh.toFixed(unit === 'mah' ? 1 : 2)} ${label}`}</title></rect>)}
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
    // The same in current and charge: mA from the supply, mAh used.
    const averageMA = averageW / V * 1000;
    const mAhOf = (u: typeof today) => Object.values(u.mAh).reduce((s, v) => s + v, 0);
    return {
      hasData: readings.length > 1, latest, interval, live, mA, watts: mA * V / 1000,
      today, todayWh, todayCost: todayWh / 1000 * settings.tariff,
      day, dayWh, averageW, monthKwh, monthCost: monthKwh * settings.tariff,
      sinceBootWh: latest?.uptime !== undefined ? averageW * latest.uptime / 3600 : undefined,
      averageMA, todayMAh: mAhOf(today), dayMAh: mAhOf(day), perDayWh: averageW * 24, perDayMAh: averageMA * 24,
      sinceBootMAh: latest?.uptime !== undefined ? averageMA * latest.uptime / 3600 : undefined,
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
  const [unit, setUnit] = useState<Unit>(storedUnit);
  const pickUnit = (u: Unit) => { setUnit(u); try { localStorage.setItem(UNIT_KEY, u); } catch {} };
  const amps = unit === 'mah';

  if (!e.hasData) return <div className="grid"><section className="panel span-all empty-state energy-empty">
    <h3>{t.e.waitTitle}</h3><p>{t.e.waitText}</p>
  </section></div>;

  const today = amps ? formatCharge(e.todayMAh) : formatEnergy(e.todayWh);
  const boot = amps ? formatCharge(e.sinceBootMAh) : formatEnergy(e.sinceBootWh);
  const perDay = amps ? formatCharge(e.perDayMAh) : formatEnergy(e.perDayWh);
  const monthMAh = formatCharge(e.perDayMAh * 30);
  const enabled = parts.filter(p => settings.parts.includes(p.id));
  const off = parts.filter(p => !settings.parts.includes(p.id));
  const rows = enabled.map(p => {
    const wh = e.day.mAh[p.id] * V / 1000;
    return { p, wh, mAh: e.day.mAh[p.id], share: e.dayWh ? wh / e.dayWh : 0, avg: e.day.hours ? e.day.mAh[p.id] / e.day.hours : 0, now: e.live.find(l => l.part.id === p.id)!.mA };
  }).sort((a, b) => b.wh - a.wh);
  const mA = (v: number) => v >= 10 ? v.toFixed(0) : v >= 0.1 ? v.toFixed(1) : v.toFixed(3);
  const money = (v: number) => <b className="mono" dir="ltr">{formatMoney(v)} {cur}</b>;

  return <>
    <div className="energy-units">
      <Segmented label={t.e.unitLabel} value={unit} onChange={pickUnit} options={[['wh', t.e.units.wh], ['mah', t.e.units.mah]]}/>
    </div>
    <div className="readouts energy-readouts">
      <article className="metric-card">
        <header><span className="swatch power-swatch"/><h2>{amps ? t.e.currentNow : t.e.powerNow}</h2><span className="source mono" dir="ltr">{V} V</span></header>
        {amps
          ? <div className="metric-value" dir="ltr"><strong className="mono">{e.mA.toFixed(0)}</strong><span>mA</span></div>
          : <div className="metric-value" dir="ltr"><strong className="mono">{e.watts.toFixed(2)}</strong><span>W</span></div>}
        <div className="metric-meta">{amps
          ? <span>{t.e.power} <b className="mono" dir="ltr">{e.watts.toFixed(2)} W</b> · <b className="mono" dir="ltr">{(e.mA / 1000).toFixed(3)} A</b></span>
          : <span>{t.e.current} <b className="mono" dir="ltr">{e.mA.toFixed(0)} mA</b></span>}</div>
      </article>
      <article className="metric-card">
        <header><h2>{amps ? t.e.todayCharge : t.e.today}</h2><span className="source mono" dir="ltr">{shortTime(new Date(now).setHours(0, 0, 0, 0))} →</span></header>
        <div className="metric-value" dir="ltr"><strong className="mono">{today.value}</strong><span>{today.unit}</span></div>
        <div className="metric-meta"><span>{t.e.onFor(e.today.hours.toFixed(1))} · ≈ {money(e.todayCost)}</span></div>
      </article>
      <article className="metric-card">
        <header><h2>{t.e.boot}</h2><span className="source mono" dir="ltr">{formatUptime(e.latest?.uptime)}</span></header>
        <div className="metric-value" dir="ltr"><strong className="mono">{boot.value}</strong><span>{boot.unit}</span></div>
        <div className="metric-meta"><span>{e.sinceBootWh === undefined ? t.e.noUptime : amps ? t.e.fromUptimeMA(e.averageMA.toFixed(0)) : t.e.fromUptime}</span></div>
      </article>
      <article className="metric-card">
        <header><h2>{t.e.perDay}</h2><span className="source mono" dir="ltr">24 h</span></header>
        <div className="metric-value" dir="ltr"><strong className="mono">{perDay.value}</strong><span>{perDay.unit}</span></div>
        <div className="metric-meta">{amps
          ? <span>{t.e.month} <b className="mono" dir="ltr">{monthMAh.value} {monthMAh.unit}</b> · {t.e.atAvg} <b className="mono" dir="ltr">{e.averageMA.toFixed(0)} mA</b></span>
          : <span>{t.e.month} <b className="mono" dir="ltr">{e.monthKwh.toFixed(2)} kWh</b> ≈ {money(e.monthCost)}</span>}</div>
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
            <th className="num">{t.e.avg} <span dir="ltr">(mA)</span></th><th className="num">{amps ? t.e.charge : t.e.energy} <span dir="ltr">({amps ? 'mAh' : 'Wh'})</span></th><th className="share-col">{t.e.share}</th>
          </tr></thead>
          <tbody>{rows.map(r => <tr key={r.p.id}>
            <td><b>{t.parts[r.p.id].name}</b><small>{t.parts[r.p.id].role}</small></td>
            <td><span className={`kind ${r.p.kind}`}>{t.e.kind[r.p.kind]}</span></td>
            <td className="num"><span dir="ltr">{mA(r.now)}</span></td>
            <td className="num"><span dir="ltr">{mA(r.avg)}</span></td>
            <td className="num"><span dir="ltr">{amps ? r.mAh.toFixed(r.mAh < 10 ? 2 : 0) : r.wh.toFixed(r.wh < 0.1 ? 3 : 2)}</span></td>
            <td className="share-col"><div className="share" dir="ltr"><span className="share-track"><i style={{ width: `${r.share * 100}%` }}/></span><span className="mono">{(r.share * 100).toFixed(r.share < 0.01 ? 1 : 0)}%</span></div></td>
          </tr>)}</tbody>
          <tfoot><tr>
            <th scope="row">{t.e.total}</th><td/>
            <td className="num"><span dir="ltr">{e.mA.toFixed(0)}</span></td>
            <td className="num"><span dir="ltr">{e.day.hours ? (e.averageW / V * 1000).toFixed(0) : '—'}</span></td>
            <td className="num"><span dir="ltr">{amps ? e.dayMAh.toFixed(0) : e.dayWh.toFixed(2)}</span></td><td className="share-col"/>
          </tr></tfoot>
        </table></div>
        {off.length > 0 && <p className="footnote parts-off">{t.e.off(off.map(p => t.parts[p.id].name).join(t.dir === 'rtl' ? '، ' : ', '))}</p>}
      </section>

      <section className="panel span-2">
        <header className="panel-head"><div><h2>{amps ? t.e.hourlyCharge : t.e.hourly}</h2><p>{amps ? t.e.hourlyChargeSub : t.e.hourlySub}</p></div></header>
        <HourlyBars hours={hours} unit={unit} volts={V}/>
      </section>

      <section className="panel method-panel">
        <header className="panel-head"><div><h2>{t.e.method}</h2><p>{t.e.methodSub}</p></div></header>
        <p className="formula" dir="ltr">{amps ? 'Q = I × t' : 'E = V × I × t'}</p>
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
