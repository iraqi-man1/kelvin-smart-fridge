import { exceeds, isAlert, limitFor, metricInfo, metrics } from './data';
import { hourlyChart, partsChart, readingChart } from './excelCharts';
import { forecast } from './forecast';
import { hourlyWh, parts, usageBetween } from './power';
import type { Dict } from './i18n';
import type { Reading, Settings } from './types';

// exceljs writes Date cells as UTC, so shift each time to show the local clock in Excel.
const local = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000);

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3B63' } } as const;
const BAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F5F8' } } as const;
const OVER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } } as const;
const THIN = { style: 'thin', color: { argb: 'FFD5DAE0' } } as const;

type Options = { readings: Reading[]; settings: Settings; t: Dict; source: string; app: string; student: string; by: string };

const PART_COLORS = ['#1c7ed6', '#e8590c', '#0ca678', '#c2255c', '#7048e8', '#f59f00', '#d9480f', '#495057'];

/** Builds the workbook (readings, summary, energy, charts) and starts the download. */
export async function downloadExcel({ readings, settings, t, source, app, student, by }: Options) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = `${app} · ${student}`;
  book.created = new Date();
  book.calcProperties.fullCalcOnLoad = true; // the energy totals are formulas
  const rtl = t.dir === 'rtl';
  const sorted = readings.slice().sort((a, b) => a.timestamp - b.timestamp);
  const unitLabel = (m: typeof metrics[number]) => `${t.metric[m].short} (${metricInfo[m].unit})`;

  // Sheet 1: one row per reading.
  const sheet = book.addWorksheet(t.xl.sheet, { views: [{ state: 'frozen', ySplit: 1, rightToLeft: rtl }] });
  sheet.columns = [
    { header: t.xl.date, key: 'date', width: 13, style: { numFmt: 'yyyy-mm-dd' } },
    { header: t.xl.time, key: 'time', width: 14, style: { numFmt: 'h:mm:ss AM/PM' } },
    ...metrics.map(m => ({ header: unitLabel(m), key: m, width: 18, style: { numFmt: metricInfo[m].digits ? '0.0' : '0' } })),
    { header: t.xl.status, key: 'status', width: 34 },
    { header: t.xl.device, key: 'device', width: 18 },
  ];
  for (const r of sorted) {
    const over = metrics.filter(m => exceeds(m, r[m], settings));
    const row = sheet.addRow({
      date: local(r.timestamp), time: local(r.timestamp), ...Object.fromEntries(metrics.map(m => [m, r[m]])),
      status: over.length ? `${t.table.over}: ${over.map(m => t.metric[m].short).join(rtl ? '، ' : ', ')}` : t.table.within,
      device: r.deviceId ?? '',
    });
    if (row.number % 2 === 1) row.eachCell(c => { c.fill = BAND_FILL; });
    for (const m of over) { const c = row.getCell(m); c.font = { bold: true, color: { argb: 'FFC92A2A' } }; c.fill = OVER_FILL; }
    if (over.length) row.getCell('status').font = { bold: true, color: { argb: 'FFC92A2A' } };
  }
  const head = sheet.getRow(1);
  head.height = 22;
  head.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEAD_FILL;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  sheet.eachRow(row => row.eachCell(c => { c.border = { bottom: THIN }; }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  // Sheet 2: what the export covers, then min / average / max per measure.
  const sum = book.addWorksheet(t.xl.summary, { views: [{ rightToLeft: rtl }] });
  sum.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  const title = sum.addRow([`${app} — ${t.xl.title}`]);
  title.font = { bold: true, size: 15, color: { argb: 'FF1F3B63' } };
  sum.addRow([]);
  const info: [string, string | number | Date][] = [
    [t.set.deviceName, settings.deviceName],
    [t.device.location, settings.room],
    [t.status.source, source],
    [t.xl.exportedAt, local(Date.now())],
    [t.xl.by, by],
    [t.xl.first, sorted.length ? local(sorted[0].timestamp) : '—'],
    [t.xl.last, sorted.length ? local(sorted.at(-1)!.timestamp) : '—'],
    [t.xl.count, sorted.length],
    [t.xl.alerts, sorted.filter(r => isAlert(r, settings)).length],
    [t.designedBy, student],
  ];
  for (const [k, v] of info) {
    const row = sum.addRow([k, v]);
    row.getCell(1).font = { bold: true, color: { argb: 'FF454D5A' } };
    if (v instanceof Date) row.getCell(2).numFmt = 'yyyy-mm-dd h:mm AM/PM';
    row.getCell(2).alignment = { horizontal: rtl ? 'right' : 'left' };
  }
  sum.addRow([]);
  const statsHead = sum.addRow([t.xl.measure, t.today.min, t.today.avg, t.today.max, t.card.max]);
  statsHead.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { horizontal: 'center' }; });
  for (const m of metrics) {
    const v = sorted.map(r => r[m]);
    const row = sum.addRow(v.length
      ? [unitLabel(m), Math.min(...v), v.reduce((a, b) => a + b, 0) / v.length, Math.max(...v), limitFor(m, settings)]
      : [unitLabel(m), '—', '—', '—', limitFor(m, settings)]);
    row.getCell(1).font = { bold: true };
    for (let i = 2; i <= 5; i++) { row.getCell(i).numFmt = metricInfo[m].digits ? '0.0' : '0'; row.getCell(i).border = { bottom: THIN }; }
  }

  // Sheet 3: energy, estimated from each part's datasheet current and the readings.
  // The totals are Excel formulas, so changing the voltage or the price updates them.
  const V = settings.supplyVoltage;
  const from = sorted.length ? sorted[0].timestamp - 1 : 0, to = sorted.length ? sorted.at(-1)!.timestamp : 0;
  const usage = usageBetween(sorted, from, to, settings);
  const enabled = parts.filter(p => settings.parts.includes(p.id));
  const en = book.addWorksheet(t.xl.energySheet, { views: [{ rightToLeft: rtl }] });
  en.columns = [{ width: 30 }, { width: 46 }, { width: 15 }, { width: 16 }, { width: 15 }, { width: 12 }];
  const eTitle = en.addRow([`${app} — ${t.xl.energyTitle}`]);
  eTitle.font = { bold: true, size: 15, color: { argb: 'FF1F3B63' } };
  en.addRow([t.xl.energyNote]).font = { italic: true, color: { argb: 'FF697281' } };
  en.addRow([]);
  const infoRow = (k: string, v: number | string, fmt?: string) => {
    const row = en.addRow([k, v]);
    row.getCell(1).font = { bold: true, color: { argb: 'FF454D5A' } };
    if (fmt) row.getCell(2).numFmt = fmt;
    row.getCell(2).alignment = { horizontal: rtl ? 'right' : 'left' };
    return row.number;
  };
  const vRow = infoRow(t.xl.supply, V, '0.0');
  const priceRow = infoRow(`${t.xl.tariff} (${settings.currency})`, settings.tariff, '0.000');
  infoRow(t.xl.hoursOn, +usage.hours.toFixed(3), '0.00');
  infoRow(t.xl.sends, usage.sends);
  infoRow(t.xl.alertHours, +usage.alertHours.toFixed(3), '0.00');
  en.addRow([]);
  const ph = en.addRow([t.xl.part, t.xl.role, t.xl.current, t.xl.charge, t.xl.energy, t.xl.share]);
  ph.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { horizontal: 'center', wrapText: true }; });
  const firstPart = ph.number + 1, lastPart = ph.number + enabled.length, totalRow = lastPart + 1;
  const totalShare = Object.values(usage.mAh).reduce((s, v) => s + v, 0);
  enabled.forEach((p, i) => {
    const r = firstPart + i, mAh = usage.mAh[p.id] ?? 0;
    const row = en.addRow([t.parts[p.id as keyof typeof t.parts].name, t.parts[p.id as keyof typeof t.parts].role, p.mA, +mAh.toFixed(4),
      { formula: `D${r}*B${vRow}/1000`, result: mAh * V / 1000 },
      { formula: `IF(E${totalRow}=0,0,E${r}/E${totalRow})`, result: totalShare ? mAh / totalShare : 0 }]);
    row.getCell(3).numFmt = '0.0'; row.getCell(4).numFmt = '0.000'; row.getCell(5).numFmt = '0.000'; row.getCell(6).numFmt = '0%';
    if (i % 2) row.eachCell(c => { c.fill = BAND_FILL; });
    row.eachCell(c => { c.border = { bottom: THIN }; });
  });
  const totalWhValue = Object.values(usage.mAh).reduce((s, v) => s + v, 0) * V / 1000;
  const tot = en.addRow([t.xl.total, '', '', { formula: `SUM(D${firstPart}:D${lastPart})`, result: totalShare }, { formula: `SUM(E${firstPart}:E${lastPart})`, result: totalWhValue }, { formula: `IF(E${totalRow}=0,0,1)`, result: 1 }]);
  tot.font = { bold: true }; tot.getCell(4).numFmt = '0.000'; tot.getCell(5).numFmt = '0.000'; tot.getCell(6).numFmt = '0%';
  en.addRow([]);
  const kwhRow = infoRow(t.xl.kwh, 0, '0.00000');
  en.getCell(`B${kwhRow}`).value = { formula: `E${totalRow}/1000`, result: totalWhValue / 1000 };
  const costRow = infoRow(`${t.xl.cost} (${settings.currency})`, 0, '0.0000');
  en.getCell(`B${costRow}`).value = { formula: `B${kwhRow}*B${priceRow}`, result: totalWhValue / 1000 * settings.tariff };
  const monthRow = infoRow(t.xl.monthKwh, 0, '0.000');
  en.getCell(`B${monthRow}`).value = { formula: `IF(B${vRow + 2}=0,0,E${totalRow}/B${vRow + 2}*24*30/1000)`, result: usage.hours ? totalWhValue / usage.hours * 24 * 30 / 1000 : 0 };
  const monthCostRow = infoRow(`${t.xl.monthCost} (${settings.currency})`, 0, '0.00');
  en.getCell(`B${monthCostRow}`).value = { formula: `B${monthRow}*B${priceRow}`, result: (usage.hours ? totalWhValue / usage.hours * 24 * 30 / 1000 : 0) * settings.tariff };
  // Charge per day in mAh (what a battery or power bank is rated in): the parts' mAh over the hours on, times 24.
  const dayMAhRow = infoRow(t.xl.perDayMAh, 0, '0');
  en.getCell(`B${dayMAhRow}`).value = { formula: `IF(B${vRow + 2}=0,0,D${totalRow}/B${vRow + 2}*24)`, result: usage.hours ? totalShare / usage.hours * 24 : 0 };
  for (const r of [kwhRow, costRow, monthRow, monthCostRow, dayMAhRow]) en.getRow(r).getCell(2).font = { bold: true, color: { argb: 'FF1F3B63' } };

  // Energy per clock hour, for the last 24 hours of the export.
  en.addRow([]);
  const hours = sorted.length ? hourlyWh(sorted, to, settings, 24) : [];
  const hh = en.addRow([t.xl.hour, t.xl.energy, t.xl.minutesOn, t.xl.charge]);
  hh.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { horizontal: 'center' }; });
  for (const h of hours) {
    const row = en.addRow([local(h.start), +h.wh.toFixed(4), Math.round(h.hours * 60), +(h.wh * 1000 / V).toFixed(2)]);
    row.getCell(1).numFmt = 'yyyy-mm-dd h:mm AM/PM'; row.getCell(2).numFmt = '0.000'; row.getCell(4).numFmt = '0.0';
    row.eachCell(c => { c.border = { bottom: THIN }; });
  }

  // Pictures of the energy charts, beside the tables.
  const picture = (sheet: typeof en, dataUrl: string, col: number, row: number, w: number, h: number) =>
    sheet.addImage(book.addImage({ base64: dataUrl, extension: 'png' }), { tl: { col, row }, ext: { width: w, height: h } });
  if (sorted.length > 1) {
    const partRows = enabled.map((p, i) => ({ name: t.parts[p.id as keyof typeof t.parts].name, wh: (usage.mAh[p.id] ?? 0) * V / 1000, color: PART_COLORS[i % PART_COLORS.length] })).sort((a, b) => b.wh - a.wh);
    picture(en, partsChart(partRows, { title: t.xl.partsTitle, sub: t.xl.energyNote }, rtl), 7, 1, 760, Math.round((54 + partRows.length * 34 + 20) * 760 / 1100));
    picture(en, hourlyChart(hours, { title: t.xl.hourlyTitle, sub: `${settings.supplyVoltage} V` }, rtl), 7, 18, 760, 235);
  }

  // Sheet 4: one chart per sensor, with the limit and the forecast for the next hour.
  const ch = book.addWorksheet(t.xl.chartsSheet, { views: [{ rightToLeft: rtl, showGridLines: false }] });
  ch.getCell('A1').value = `${app} — ${t.xl.chartsTitle}`;
  ch.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF1F3B63' } };
  ch.getCell('A2').value = t.xl.chartsNote;
  ch.getCell('A2').font = { italic: true, color: { argb: 'FF697281' } };
  metrics.forEach((m, i) => {
    const fc = forecast(sorted, m, 3600000, settings);
    const img = readingChart(sorted, m, settings, {
      title: `${t.metric[m].name} (${metricInfo[m].unit})`,
      sub: fc ? t.xl.forecastSub(fc.points.at(-1)!.v.toFixed(metricInfo[m].digits), metricInfo[m].unit) : t.xl.noForecast,
      limit: t.chart.maxLimit, forecast: t.chart.showForecast,
    }, rtl, fc);
    picture(ch, img, 0, 3 + i * 15, 880, 272);
  });

  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${app.toLowerCase()}-readings-${local(Date.now()).toISOString().slice(0, 10)}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
