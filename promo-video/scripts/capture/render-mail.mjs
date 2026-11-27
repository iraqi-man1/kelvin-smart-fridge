// The two emails from the recording, drawn with the app's own template (server/mailer.mjs).
import { codeEmail } from 'file:///C:/Users/Ali PC/Desktop/iot/Mini Project/website/server/mailer.mjs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/Ali PC/Desktop/iot/Mini Project/website/package.json');
const { chromium } = require('playwright');
const tl = JSON.parse(fs.readFileSync('rec/timeline.json', 'utf8'));
fs.mkdirSync('mailimg', { recursive: true });
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage({ viewport: { width: 560, height: 520 }, deviceScaleFactor: 2 });
for (const m of tl.mails) {
  const purpose = m.kind === 'signup' ? 'signup' : 'enable';
  const mail = codeEmail({ code: m.code, purpose, lang: 'en', name: 'Ali Ahmed' });
  const html = `<div style="font:14px 'Segoe UI',sans-serif;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 0 0 1px #e2e8f0">
    <div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><div style="color:#64748b;font-size:12px">From: Kelvin &lt;kelvin@kelvin.test&gt; · To: ali@kelvin.test</div><div style="font-weight:700;font-size:16px;margin-top:4px;color:#0f172a">${mail.subject}</div></div>
    ${mail.html.replace(/^<!doctype html><html><body[^>]*>/, '<div style="padding:16px;background:#f1f2f4">').replace(/<\/body><\/html>$/, '</div>')}</div>`;
  await p.setContent(`<body style="margin:0;padding:10px;background:transparent">${html}</body>`);
  const el = p.locator('body > div'); await el.screenshot({ path: `mailimg/${m.kind}.png`, omitBackground: true });
  console.log(m.kind, mail.subject);
}
await b.close();
