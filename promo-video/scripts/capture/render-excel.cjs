// Draws each sheet of the real downloaded workbook (cells, fills, widths, embedded charts)
// in a spreadsheet-style view, 1920×1080, for the video. node render-excel.cjs <website dir> <xlsx> <outdir>
const [WEB, XLSX, OUT] = process.argv.slice(2);
const ExcelJS = require(WEB + '/node_modules/exceljs');
const { chromium } = require(WEB + '/node_modules/playwright');
const fs = require('fs'), path = require('path');
fs.mkdirSync(OUT, { recursive: true });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const argb = c => c && c.argb ? '#' + c.argb.slice(2) : null;

function fmt(cell) {
  let v = cell.value; if (v && typeof v === 'object' && 'formula' in v) v = v.result;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const f = cell.numFmt || '', d = v, p = n => String(n).padStart(2, '0');
    const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    const h = d.getUTCHours(), time12 = `${h % 12 || 12}:${p(d.getUTCMinutes())}${/ss/.test(f) ? ':' + p(d.getUTCSeconds()) : ''} ${h < 12 ? 'AM' : 'PM'}`;
    return /h/.test(f) && /y/.test(f) ? `${date} ${time12}` : /h/.test(f) ? time12 : date;
  }
  if (typeof v === 'number') { const f = cell.numFmt || ''; if (f.includes('%')) return (v * 100).toFixed(0) + '%'; const m = f.match(/0\.(0+)/); return m ? v.toFixed(m[1].length) : f === '0' ? String(Math.round(v)) : String(v); }
  if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text).join('');
  return String(v);
}

function sheetHtml(wb, ws, { file, selected, rows = 40 }) {
  const cols = Math.max(ws.columnCount, 1) + 2;
  const widths = Array.from({ length: cols }, (_, i) => Math.round(((ws.getColumn(i + 1).width || 9) * 7.2 + 10)));
  const heights = Array.from({ length: rows }, (_, i) => Math.round((ws.getRow(i + 1).height || 15) * 1.6));
  const left = [0]; widths.forEach((w, i) => left.push(left[i] + w));
  const top = [0]; heights.forEach((h, i) => top.push(top[i] + h));
  let cells = '';
  for (let r = 1; r <= rows; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c), txt = fmt(cell); const st = cell.style || {};
      const fill = st.fill && st.fill.fgColor ? argb(st.fill.fgColor) : null;
      const color = st.font && st.font.color ? argb(st.font.color) : '#1f2937';
      const bold = st.font && st.font.bold, italic = st.font && st.font.italic, size = st.font && st.font.size ? st.font.size * 1.45 : 15;
      const align = (st.alignment && st.alignment.horizontal) || (typeof (cell.value && cell.value.result !== undefined ? cell.value.result : cell.value) === 'number' ? 'right' : 'left');
      const isSel = selected && selected.r === r && selected.c === c;
      if (!txt && !fill && !isSel) continue;
      cells += `<div class="cell${isSel ? ' sel' : ''}" style="left:${left[c - 1]}px;top:${top[r - 1]}px;width:${widths[c - 1]}px;height:${heights[r - 1]}px;${fill ? `background:${fill};` : ''}color:${color};font-weight:${bold ? 700 : 400};${italic ? 'font-style:italic;' : ''}font-size:${size}px;text-align:${align};justify-content:${align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'}">${esc(txt)}</div>`;
    }
  }
  // Charts and pictures, placed at their anchors.
  let imgs = '';
  for (const im of ws.getImages()) {
    const media = wb.model.media.find((m, i) => i === Number(im.imageId) || m.index === Number(im.imageId)) || wb.model.media[Number(im.imageId)];
    if (!media) continue;
    const tl = im.range.tl, br = im.range.br, ext = im.range.ext;
    const x = left[Math.floor(tl.nativeCol ?? tl.col)] + 4, y = top[Math.floor(tl.nativeRow ?? tl.row)] + 4;
    let w, h;
    if (ext) { w = ext.width * 1.2; h = ext.height * 1.2; } else { w = left[Math.floor(br.nativeCol ?? br.col)] - x; h = top[Math.floor(br.nativeRow ?? br.row)] - y; }
    imgs += `<img class="chart" src="data:image/${media.extension};base64,${Buffer.from(media.buffer).toString('base64')}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`;
  }
  const colHead = widths.map((w, i) => `<div style="width:${w}px" class="${selected && selected.c === i + 1 ? 'on' : ''}">${colName(i)}</div>`).join('');
  const rowHead = heights.map((h, i) => `<div style="height:${h}px" class="${selected && selected.r === i + 1 ? 'on' : ''}">${i + 1}</div>`).join('');
  const selCell = selected ? ws.getRow(selected.r).getCell(selected.c) : null;
  const formula = selCell ? (selCell.value && selCell.value.formula ? '=' + selCell.value.formula : fmt(selCell)) : '';
  const tabs = wb.worksheets.map(s => `<div class="tab${s === ws ? ' on' : ''}">${esc(s.name)}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:100vw;height:100vh;font-family:"Segoe UI",Calibri,Arial,sans-serif;background:#fff;overflow:hidden}
  .bar{height:56px;background:#1d6f42;color:#fff;display:flex;align-items:center;padding:0 24px;gap:18px;font-size:20px}
  .bar b{font-weight:600}.bar span{opacity:.8;font-size:16px}
  .fx{height:46px;border-bottom:1px solid #d4d4d8;display:flex;align-items:center;font-size:18px;background:#fafafa}
  .fx .ref{width:120px;text-align:center;border-right:1px solid #d4d4d8;color:#374151;font-weight:600}.fx .fn{padding:0 14px;color:#6b7280;font-style:italic;border-right:1px solid #d4d4d8}.fx .val{padding:0 14px;color:#111827;font-family:Consolas,monospace}
  .grid{position:absolute;top:102px;left:0;right:0;bottom:56px;overflow:hidden}
  .ch{position:absolute;left:52px;top:0;height:30px;display:flex;background:#f3f4f6;border-bottom:1px solid #d4d4d8}
  .ch div{border-right:1px solid #d4d4d8;text-align:center;font-size:15px;line-height:30px;color:#4b5563}
  .rh{position:absolute;left:0;top:30px;width:52px;background:#f3f4f6;border-right:1px solid #d4d4d8}
  .rh div{border-bottom:1px solid #d4d4d8;text-align:center;font-size:14px;color:#4b5563;display:flex;align-items:center;justify-content:center}
  .ch .on,.rh .on{background:#d1e7dd;color:#1d6f42;font-weight:700}
  .sheet{position:absolute;left:52px;top:30px;right:0;bottom:0;background-image:linear-gradient(#e5e7eb 1px,transparent 1px),linear-gradient(90deg,#e5e7eb 1px,transparent 1px);background-size:100% ${heights[3] || 24}px,72px 100%}
  .cell{position:absolute;box-sizing:border-box;padding:0 8px;display:flex;align-items:center;white-space:nowrap;overflow:hidden;border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;background-clip:padding-box}
  .cell.sel{outline:3px solid #1d6f42;outline-offset:-2px;z-index:2}
  .chart{position:absolute;box-shadow:0 4px 18px rgba(0,0,0,.12);border:1px solid #d4d4d8}
  .tabs{position:absolute;bottom:0;left:0;right:0;height:56px;background:#f3f4f6;border-top:1px solid #d4d4d8;display:flex;align-items:flex-start;padding-left:60px;gap:2px}
  .tab{padding:12px 28px;font-size:18px;color:#4b5563;border-bottom:4px solid transparent}.tab.on{background:#fff;color:#1d6f42;font-weight:700;border-bottom-color:#1d6f42}
  </style></head><body>
  <div class="bar"><b>${esc(file)}</b><span>${esc(ws.name)} · ${ws.rowCount} rows</span></div>
  <div class="fx"><div class="ref">${selected ? colName(selected.c - 1) + selected.r : 'A1'}</div><div class="fn">fx</div><div class="val">${esc(formula)}</div></div>
  <div class="grid"><div class="ch">${colHead}</div><div class="rh">${rowHead}</div><div class="sheet">${cells}${imgs}</div></div>
  <div class="tabs">${tabs}</div></body></html>`;
}

(async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(XLSX);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const plans = [['Readings', { r: 2, c: 3 }, 30, 1920, 1080], ['Summary', { r: 11, c: 2 }, 24, 1920, 1080], ['Energy', { r: 11, c: 5 }, 40, 2500, 1080], ['Charts', null, 160, 1920, 3400]];
  for (const [name, sel, rows, vw, vh] of plans) {
    await p.setViewportSize({ width: vw, height: vh });
    const ws = wb.getWorksheet(name); if (!ws) { console.log('no sheet', name); continue; }
    await p.setContent(sheetHtml(wb, ws, { file: path.basename(XLSX), selected: sel, rows }), { waitUntil: 'load' });
    await p.screenshot({ path: path.join(OUT, `excel-${name.toLowerCase()}.png`) });
    console.log('sheet', name);
  }
  await b.close();
})();
