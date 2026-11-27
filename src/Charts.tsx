import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { forecast, forecastAt, smoothPath, type Forecast } from './forecast';
import { exceeds, fmt, limitFor, metricInfo, metrics, READING_EVERY, shortTime, timeFormat } from './data';

// One reading every 1 h 30 min: the line is broken only where a reading is missing.
const LINE_GAP = READING_EVERY + 15 * 60000;
import { useT } from './i18n';
import type { Metric, Reading, Settings } from './types';

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;

export function niceStep(range: number, count: number) {
  const raw = range / count, pow = 10 ** Math.floor(Math.log10(raw)), n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function domainFor(values: number[]) {
  if (!values.length) return { min: 0, max: 1, ticks: [] as number[] };
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 2) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, 3);
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(+v.toFixed(2));
  return { min, max, ticks };
}

export function timeTicks(start: number, end: number) {
  const span = end - start;
  const step = span <= 3600000 ? 600000 : span <= 6 * 3600000 ? 3600000 : span <= 32 * 3600000 ? 4 * 3600000 : span <= 4 * 86400000 ? 12 * 3600000 : 86400000;
  const offset = new Date(start).getTimezoneOffset() * 60000;
  const ticks: number[] = [];
  for (let t = Math.ceil((start - offset) / step) * step + offset; t <= end; t += step) ticks.push(t);
  return ticks;
}

/** The time at the cursor; with the date on charts longer than a day. */
const whenLabel = (tm: number, span: number) => span <= 32 * 3600000 ? timeFormat(tm) : `${new Date(tm).getDate()}/${new Date(tm).getMonth() + 1} ${shortTime(tm)}`;

/** A time under the chart: the hour on a day's chart, the date (and hour) on longer ones. */
export function tickLabel(tk: number, span: number) {
  if (span <= 32 * 3600000) return shortTime(tk);
  const d = new Date(tk), day = `${d.getDate()}/${d.getMonth() + 1}`;
  return span <= 4 * 86400000 && d.getHours() ? `${day} ${shortTime(tk)}` : day;
}

/** An earlier period drawn over this one: its readings and how far back it is (ms). */
export type Comparison = { data: Reading[]; offset: number; label: string };

const mean = (list: Reading[], m: Metric) => list.length ? list.reduce((a, r) => a + r[m], 0) / list.length : undefined;

/** One row per measurement, sharing a time axis and a single cursor. */
export function StripChart({ data, start, end, settings, horizon = 0, compare = null }: { data: Reading[]; start: number; end: number; settings: Settings; horizon?: number; compare?: Comparison | null }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  // The point under the mouse: a reading, or (past the last reading) a time in the forecast.
  const [hover, setHover] = useState<{ t: number; r: Reading | null } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  // Clear the cursor only when the period changes, not on every clock tick.
  useEffect(() => setHover(null), [end - start]); // eslint-disable-line react-hooks/exhaustive-deps

  // With a forecast, the time axis runs on past "now" into a shaded future zone.
  const forecasts = useMemo(() => horizon ? Object.fromEntries(metrics.map(m => [m, forecast(data, m, horizon, settings)])) as Record<Metric, Forecast | null> : null, [data, horizon, settings]);
  const showFuture = Boolean(forecasts && Object.values(forecasts).some(Boolean));
  const axisEnd = showFuture ? end + horizon : end;
  const padL = 46, padR = 14, rowH = 84, top = 8, bottom = rowH - 10;
  const plotW = width - padL - padR;
  const x = (t: number) => padL + (t - start) / (axisEnd - start) * plotW;
  const aheadLabel = t.chart.ahead(Math.round(horizon / 60000));
  // The earlier period, moved forward onto this period's time axis.
  const before = useMemo(() => compare ? compare.data.map(r => ({ ...r, timestamp: r.timestamp + compare.offset })).filter(r => r.timestamp >= start && r.timestamp <= end) : [], [compare, start, end]);
  const beforeGap = useMemo(() => {
    if (before.length < 2) return LINE_GAP;
    const steps = before.slice(1).map((r, i) => r.timestamp - before[i].timestamp).sort((a, b) => a - b);
    return Math.max(LINE_GAP, steps[Math.floor(steps.length / 2)] * 3);
  }, [before]);
  const beforeAt = (tm: number) => {
    let best: Reading | null = null;
    for (const r of before) if (!best || Math.abs(r.timestamp - tm) < Math.abs(best.timestamp - tm)) best = r;
    return best && Math.abs(best.timestamp - tm) <= beforeGap ? best : null;
  };
  const latest = data.at(-1);
  const future = Boolean(hover && !hover.r);
  const shown = hover ? hover.r : latest ?? null;

  function onMove(event: PointerEvent<HTMLDivElement>) {
    if (!data.length) return;
    const px = event.clientX - ref.current!.getBoundingClientRect().left;
    // Same scale as x(): the axis runs to the end of the forecast when one is shown.
    const target = Math.min(axisEnd, Math.max(start, start + (px - padL) / plotW * (axisEnd - start)));
    const lastT = data.at(-1)!.timestamp;
    if (showFuture && target > lastT && x(target) - x(lastT) > 4) { setHover({ t: target, r: null }); return; }
    let closest = data[0];
    for (const r of data) if (Math.abs(r.timestamp - target) < Math.abs(closest.timestamp - target)) closest = r;
    setHover({ t: closest.timestamp, r: closest });
  }

  return <div className="strip-chart" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
    <div className="strip-cursor" dir={t.dir}>
      <span>{future ? t.chart.forecastAt : hover ? t.chart.atCursor : t.chart.latest}</span>
      <b className="mono" dir="ltr">{hover ? whenLabel(hover.t, end - start) : shown ? whenLabel(shown.timestamp, end - start) : '—'}</b>
    </div>
    {metrics.map(metric => {
      const info = metricInfo[metric];
      const fc = forecasts?.[metric] ?? null;
      const domain = domainFor([...data.map(r => r[metric]), ...before.map(r => r[metric]), ...(fc ? fc.points.flatMap(p => [p.v, p.lo, p.hi]) : [])]);
      const y = (v: number) => bottom - (v - domain.min) / (domain.max - domain.min) * (bottom - top);
      const limit = limitFor(metric, settings);
      const limitVisible = data.length > 0 && limit >= domain.min && limit <= domain.max;
      // Break the line where the device was silent, rather than drawing through the gap.
      const path = data.map((r, i) => `${i && r.timestamp - data[i - 1].timestamp < LINE_GAP ? 'L' : 'M'}${x(r.timestamp).toFixed(1)},${y(r[metric]).toFixed(1)}`).join('');
      const ahead = future && fc && hover ? forecastAt(fc, Math.min(hover.t, fc.points.at(-1)!.t)) : null;
      const value = future ? ahead?.v : shown?.[metric];
      const last = fc?.points.at(-1);
      const band = fc ? `${smoothPath(fc.points.map(p => [x(p.t), y(p.hi)]))}${smoothPath(fc.points.slice().reverse().map(p => [x(p.t), y(p.lo)]), false)}Z` : '';
      const line = fc ? smoothPath(fc.points.map(p => [x(p.t), y(p.v)])) : '';
      const beforePath = before.map((r, i) => `${i && r.timestamp - before[i - 1].timestamp < beforeGap ? 'L' : 'M'}${x(r.timestamp).toFixed(1)},${y(r[metric]).toFixed(1)}`).join('');
      const avgNow = mean(data, metric), avgThen = mean(before, metric);
      const diff = avgNow !== undefined && avgThen !== undefined ? avgNow - avgThen : undefined;
      const thenAtCursor = hover && !future ? beforeAt(hover.t) : null;
      const pct = diff !== undefined && avgThen ? diff / Math.abs(avgThen) * 100 : undefined;
      return <div className="strip-row" key={metric}>
        <div className="strip-head" dir={t.dir}>
          <span className="strip-name"><i className="swatch" style={{ background: info.color }}/>{t.metric[metric].name}<small dir="ltr">{info.unit}</small></span>
          <span className="strip-limit">{t.chart.maxLimit} <span className="mono" dir="ltr">{limit}</span></span>
          <b className={`strip-value mono ${value !== undefined && exceeds(metric, value, settings) ? 'over' : ''} ${future ? 'is-forecast' : ''}`} dir="ltr">{future && value !== undefined ? '≈ ' : ''}{fmt(metric, value)}</b>
        </div>
        {compare && <div className="strip-compare" dir={t.dir}>
          {hover && !future
            ? <><span>{compare.label}</span><b className="mono" dir="ltr">{thenAtCursor ? fmt(metric, thenAtCursor[metric]) : '—'}</b>
              {thenAtCursor && hover.r && <span className={`cmp-diff ${hover.r[metric] > thenAtCursor[metric] ? 'up' : hover.r[metric] < thenAtCursor[metric] ? 'down' : ''}`} dir="ltr">{signed(hover.r[metric] - thenAtCursor[metric], info.digits)}</span>}</>
            : <><span>{t.chart.avgNow}</span><b className="mono" dir="ltr">{fmt(metric, avgNow)}</b>
              <span>{t.chart.avgThen(compare.label)}</span><b className="mono" dir="ltr">{fmt(metric, avgThen)}</b>
              {diff !== undefined && <span className={`cmp-diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`} dir="ltr">{signed(diff, info.digits)}{pct !== undefined && Math.abs(pct) >= 0.5 ? ` (${signed(pct, 0)}%)` : ''}</span>}
              {!before.length && <span className="muted">{t.chart.cmpEmpty}</span>}</>}
        </div>}
        {fc && last && <div className="strip-forecast" dir={t.dir}>
          <span className="fc-label">{t.chart.forecastIn(aheadLabel)}</span>
          <b className="mono" dir="ltr">{fmt(metric, last.v)}</b>
          <span className="mono muted" dir="ltr">({fmt(metric, last.lo)}–{fmt(metric, last.hi)})</span>
          <span className={`fc-trend ${fc.slopePerHour > 0 ? 'up' : fc.slopePerHour < 0 ? 'down' : ''}`}>{fc.slopePerHour === 0 ? t.chart.steady : t.chart.perHour(`${fc.slopePerHour > 0 ? '+' : ''}${fc.slopePerHour.toFixed(info.digits ? 1 : 0)}`)}</span>
          {fc.crossesAt && <span className="fc-warn">{t.chart.mayCross(Math.max(1, Math.round((fc.crossesAt - data.at(-1)!.timestamp) / 60000)))}</span>}
          {!fc.reliable && <span className="fc-rough">{t.chart.rough}</span>}
        </div>}
        <svg width={width} height={rowH} role="img" aria-label={t.chart.aria(t.metric[metric].name)}>
          {domain.ticks.map(t => <g key={t}>
            <line className="grid" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)}/>
            <text className="tick" x={padL - 8} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>)}
          {showFuture && <rect className="future-zone" x={x(end)} y={0} width={Math.max(0, width - padR - x(end))} height={rowH}/>}
          {limitVisible && <line className="limit-line" x1={padL} x2={width - padR} y1={y(limit)} y2={y(limit)}/>}
          {fc && <>
            <path d={band} fill={info.color} className="fc-band"/>
            <path d={line} fill="none" stroke={info.color} className="fc-line"/>
            {last && <circle cx={x(last.t)} cy={y(last.v)} r="3" fill="var(--surface)" stroke={info.color} strokeWidth="1.5"/>}
          </>}
          {before.length > 1 && <path d={beforePath} fill="none" stroke={info.color} className="cmp-line"/>}
          {thenAtCursor && <circle cx={x(thenAtCursor.timestamp)} cy={y(thenAtCursor[metric])} r="3.5" fill="var(--surface)" stroke={info.color} strokeWidth="1.5"/>}
          {data.length === 1
            ? <circle cx={x(data[0].timestamp)} cy={y(data[0][metric])} r="4" fill={info.color}/>
            : <>
              <path d={path} fill="none" stroke={info.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
              {/* Each saved reading (one every 1 h 30 min) as a small dot on the line. */}
              {data.length <= 200 && data.map(r => <circle key={r.id} cx={x(r.timestamp)} cy={y(r[metric])} r="2" fill={info.color}/>)}
            </>}
          {hover && <line className="cursor-line" x1={x(hover.t)} x2={x(hover.t)} y1={0} y2={rowH}/>}
          {hover?.r && <circle cx={x(hover.t)} cy={y(hover.r[metric])} r="4.5" fill={info.color} stroke="var(--surface)" strokeWidth="2"/>}
          {ahead && <>
            <line className="fc-range" x1={x(hover!.t)} x2={x(hover!.t)} y1={y(ahead.hi)} y2={y(ahead.lo)} stroke={info.color}/>
            <circle cx={x(hover!.t)} cy={y(ahead.v)} r="4.5" fill="var(--surface)" stroke={info.color} strokeWidth="2.5"/>
          </>}
        </svg>
      </div>;
    })}
    <svg className="strip-axis" width={width} height={22} aria-hidden="true">
      {timeTicks(start, axisEnd).map(tk => <g key={tk}>
        <line x1={x(tk)} x2={x(tk)} y1={0} y2={5}/>
        <text x={x(tk)} y={17} textAnchor="middle" direction="ltr">{tickLabel(tk, axisEnd - start)}</text>
      </g>)}
    </svg>
    {(showFuture || compare) && <div className="chart-legends" dir={t.dir}>
      {compare && <p className="cmp-legend"><i className="now" aria-hidden="true"/>{t.chart.thisPeriod}<i className="then" aria-hidden="true"/>{compare.label}</p>}
      {showFuture && <p className="fc-legend"><i aria-hidden="true"/>{t.chart.legend(aheadLabel)}</p>}
    </div>}
    {!data.length && <div className="chart-empty" dir={t.dir}>{t.chart.empty}</div>}
  </div>;
}

/** Where the current value sits on the sensor's range, with the alert zone marked. */
export function ScaleBar({ metric, value, settings }: { metric: Metric; value?: number; settings: Settings }) {
  const limit = limitFor(metric, settings);
  const min = 0;
  const round = metric === 'eco2' || metric === 'tvoc' ? 100 : 10;
  const max = Math.max(metricInfo[metric].max, Math.ceil(Math.max(value ?? 0, limit) * 1.15 / round) * round);
  const pct = (v: number) => clamp((v - min) / (max - min) * 100);
  const at = pct(limit);
  return <div className="scale" dir="ltr" aria-hidden="true">
    <div className="scale-track">
      <span className="scale-zone" style={{ left: `${at}%`, right: 0 }}/>
      {value !== undefined && <span className="scale-fill" style={{ width: `${pct(value)}%`, background: metricInfo[metric].color }}/>}
      <span className="scale-limit" style={{ left: `${at}%` }}/>
    </div>
    <div className="scale-labels">
      {at > 14 && <span style={{ left: 0 }}>{min}</span>}
      <span className="scale-limit-label" style={{ left: `${at}%` }}>{limit}</span>
      {at < 86 && <span style={{ right: 0 }}>{max}</span>}
    </div>
  </div>;
}
