import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Copy, Download, Eye, EyeOff, KeyRound, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, canManage, type DeviceStatus, type User } from './accountApi';
import { dateFormat, fmt, metricInfo, metrics, timeFormat } from './data';
import { useT } from './i18n';
import { Secret, SecretBlock, SecretInput } from './ui';
import type { Reading } from './types';

const BOARDS_URL = 'https://espressif.github.io/arduino-esp32/package_esp32_index.json';
const cString = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** The whole Arduino sketch, with this user's Wi-Fi, server address and device key filled in. */
export function sketch(ssid: string, password: string, server: string, key = '') {
  return String.raw`// Kelvin — ESP32 + DHT11 + CCS811 + OLED + LED + buzzer
// Sends the readings every few seconds and carries out the dashboard's commands.
// Libraries: DHT sensor library, Adafruit CCS811, Adafruit SSD1306 (+ GFX), ArduinoJson.
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_CCS811.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

const char* WIFI_NAME     = "${cString(ssid || 'YOUR_WIFI_NAME')}";
const char* WIFI_PASSWORD = "${cString(password || 'YOUR_WIFI_PASSWORD')}";
const char* SERVER_URL    = "${cString(server)}";
const char* DEVICE_KEY    = "${cString(key)}";   // empty = no key (an unprotected server)
unsigned long sendEveryMs = ${server.startsWith('https') ? '30000' : '5000 '};                 // the dashboard can change this

#define DHT_PIN    4    // DHT11 data (S / OUT)
#define LED_PIN    25   // LED + (long leg) through 220 ohm; LED - to GND
#define BUZZER_PIN 26   // to the NPN transistor's base through 1k ohm
DHT dht(DHT_PIN, DHT11);
Adafruit_CCS811 ccs;                          // I2C: SDA = GPIO 21, SCL = GPIO 22, WAK -> GND
Adafruit_SSD1306 oled(128, 64, &Wire, -1);    // OLED on the same I2C bus, address 0x3C
bool hasOled = false;
uint16_t eco2 = 400, tvoc = 0;
String acks = "";             // ids of the commands carried out, sent with the next reading
String screenMessage = "";    // the dashboard's message for the OLED
bool ledBlink = false;
unsigned long lastSend = 0;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.print("\nConnected, IP: ");
  Serial.println(WiFi.localIP());
}

void beep(int times) {
  for (int i = 0; i < times; i++) { digitalWrite(BUZZER_PIN, HIGH); delay(150); digitalWrite(BUZZER_PIN, LOW); delay(150); }
}

void showOnScreen(float t, float h) {
  if (!hasOled) return;
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);  oled.print("Kelvin");
  oled.setCursor(0, 14); oled.printf("Temp %.1f C  Hum %.0f%%", t, h);
  oled.setCursor(0, 26); oled.printf("eCO2 %u ppm", eco2);
  oled.setCursor(0, 38); oled.printf("TVOC %u ppb", tvoc);
  oled.setCursor(0, 52); oled.print(screenMessage);
  oled.display();
}

// One command from the dashboard: beep, led, message, interval or reboot.
void runCommand(JsonObject cmd) {
  String type = cmd["type"] | "";
  if (acks.length()) acks += ",";
  acks += "\"" + String((const char*)(cmd["id"] | "")) + "\"";
  if (type == "beep") beep(cmd["value"] | 1);
  else if (type == "led") {
    String v = cmd["value"] | "off";
    ledBlink = (v == "blink");
    digitalWrite(LED_PIN, v == "on" ? HIGH : LOW);
  }
  else if (type == "message") screenMessage = String((const char*)(cmd["value"] | ""));
  else if (type == "interval") sendEveryMs = (unsigned long)(cmd["value"] | 5) * 1000UL;
  else if (type == "reboot") { Serial.println("Restarting (asked by the dashboard)"); delay(500); ESP.restart(); }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  dht.begin();
  Wire.begin(21, 22);
  if (!ccs.begin()) Serial.println("CCS811 not found. Check SDA/SCL and WAK -> GND.");
  hasOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!hasOled) Serial.println("OLED not found (optional). Check its SDA/SCL.");
  WiFi.mode(WIFI_STA);
  connectWiFi();
}

void loop() {
  connectWiFi();
  if (ledBlink) digitalWrite(LED_PIN, (millis() / 400) % 2);
  if (millis() - lastSend < sendEveryMs) { delay(20); return; }
  lastSend = millis();

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) { Serial.println("DHT11 read failed. Check the data pin."); return; }
  if (ccs.available() && !ccs.readData()) {
    eco2 = ccs.geteCO2();
    tvoc = ccs.getTVOC();
    ccs.setEnvironmentalData(h, t);   // improves the CCS811 estimate
  }
  showOnScreen(t, h);

  String body = String("{\"temperature\":") + String(t, 1) +
                ",\"humidity\":" + String(h, 1) +
                ",\"eco2\":" + eco2 + ",\"tvoc\":" + tvoc +
                ",\"deviceId\":\"ESP32-WROOM-32\",\"rssi\":" + WiFi.RSSI() +
                ",\"uptime\":" + (millis() / 1000) +
                ",\"acks\":[" + acks + "]}";

  HTTPClient http;
  WiFiClientSecure secure;   // for an https:// server (the site online)
  if (strncmp(SERVER_URL, "https", 5) == 0) { secure.setInsecure(); http.begin(secure, SERVER_URL); }
  else http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_KEY)) http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(body);
  Serial.printf("Sent %s -> %d\n", body.c_str(), code);
  if (code == 201) {
    acks = "";
    JsonDocument reply;
    if (!deserializeJson(reply, http.getString())) {
      for (JsonObject cmd : reply["commands"].as<JsonArray>()) runCommand(cmd);
    }
  } else if (code == 401) {
    Serial.println("The server refused the device key. Copy the code again from Connect device.");
  }
  http.end();
}
`;
}

type Props = { apiUrl: string; user: User; onShowLive: () => void; notify: (m: string) => void };

export function ConnectGuide({ apiUrl, user, onShowLive, notify }: Props) {
  const { t, lang } = useT();
  const c = t.cn;
  const [step, setStep] = useState(0);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const id = setTimeout(() => setCopied(false), 2500); return () => clearTimeout(id); }, [copied]);
  const [latest, setLatest] = useState<Reading | null>(null);
  const [now, setNow] = useState(Date.now());
  // A new device key lives only in this window: it is shown once and goes into the code.
  const [deviceKey, setDeviceKey] = useState('');
  const [keyState, setKeyState] = useState<DeviceStatus | null>(null);
  const admin = canManage(user);
  useEffect(() => { if (admin) api.device().then(setKeyState).catch(() => {}); }, [admin]);
  // Replacing a key: the new one goes into the code; the old one keeps working until the
  // device first sends with the new key, or for a day at most.
  async function rotateKey(id: string) {
    if (!confirm(t.keys.rotateConfirm)) return;
    const r = await api.rotateKey(id);
    setDeviceKey(r.key);
    setKeyState(await api.device());
    notify(t.keys.rotated);
  }
  async function createKey() {
    const r = await api.createKey(t.keys.label);
    setDeviceKey(r.key);
    setKeyState(await api.device());
  }
  const code = useMemo(() => sketch(ssid, password, apiUrl, deviceKey), [ssid, password, apiUrl, deviceKey]);
  const last = c.steps.length - 1;

  // On the last step, watch the server for the device's readings.
  useEffect(() => {
    if (step !== last) return;
    const poll = () => document.hidden ? undefined : fetch(`/api/readings?since=${Date.now() - 600000}`).then(r => r.json()).then(b => { setLatest(b.readings?.at(-1) ?? null); setNow(Date.now()); }).catch(() => {});
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [step, last]);

  async function copy() {
    try { await navigator.clipboard.writeText(code); }
    catch {
      const area = document.createElement('textarea'); area.value = code; document.body.append(area); area.select();
      document.execCommand('copy'); area.remove();
    }
    setCopied(true);
    notify(c.copied);
  }

  // The same code as a ready Arduino file (Arduino IDE opens .ino files directly).
  function download() {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'kelvin_esp32.ino'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const wiring: [string, string][] = [
    ['DHT11 +', '3V3'], ['DHT11 S / OUT', 'GPIO 4'], ['DHT11 −', 'GND'],
    ['CCS811 VCC', '3V3'], ['CCS811 GND', 'GND'], ['CCS811 SDA', 'GPIO 21'], ['CCS811 SCL', 'GPIO 22'], ['CCS811 WAK', 'GND'],
    ['OLED VCC', '3V3'], ['OLED GND', 'GND'], ['OLED SDA', 'GPIO 21'], ['OLED SCL', 'GPIO 22'],
    ['LED + (220 Ω)', 'GPIO 25'], ['LED −', 'GND'], ['Buzzer (NPN, 1 kΩ)', 'GPIO 26'],
  ];
  const fresh = latest && now - latest.timestamp < 60000;

  return <div className="connect-guide">
    <ol className="stepper" aria-label={c.stepOf(step + 1, c.steps.length)}>
      {c.steps.map((label, i) => <li key={label}>
        <button type="button" aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''} onClick={() => setStep(i)}>
          <span className="step-num mono">{i < step ? <Check size={13}/> : i + 1}</span><span className="step-label">{label}</span>
        </button>
      </li>)}
    </ol>

    <section className="step-body" aria-live="polite">
      <p className="step-count">{c.stepOf(step + 1, c.steps.length)}</p>
      <h3>{c.steps[step]}</h3>

      {step === 0 && <>
        <p>{c.needIntro}</p>
        <ul className="check-list">{c.need.map(n => <li key={n}><Check size={15}/>{n}</li>)}</ul>
        <p className="callout"><CircleAlert size={16}/>{c.wifiNote}</p>
      </>}

      {step === 1 && <>
        <p>{c.wireIntro}</p>
        <table className="compact wiring-table">
          <thead><tr><th>{c.from}</th><th>{c.to}</th></tr></thead>
          <tbody>{wiring.map(([a, b]) => <tr key={a}><td className="mono" dir="ltr">{a}</td><td className="mono" dir="ltr">{b}</td></tr>)}</tbody>
        </table>
        <p className="callout"><CircleAlert size={16}/>{c.wakNote}</p>
      </>}

      {step === 2 && <>
        <ol className="sub-steps">{c.ideSteps.map((s, i) => <li key={s}>{s}{i === 1 && <code className="endpoint" dir="ltr">{BOARDS_URL}</code>}</li>)}</ol>
        <p className="callout"><CircleAlert size={16}/>{c.noPort}</p>
      </>}

      {step === 3 && <>
        {admin ? <div className={`key-box ${keyState?.protected || deviceKey ? 'ok' : 'warn'}`}>
          <h4>{keyState?.protected || deviceKey ? <ShieldCheck size={17}/> : <ShieldAlert size={17}/>}{t.keys.title}</h4>
          <p>{deviceKey ? t.keys.made : keyState && !keyState.protected ? t.keys.none : keyState ? t.keys.active(keyState.keys.length) : ''}</p>
          {deviceKey && <code className="endpoint" dir="ltr"><Secret label={t.keys.title}>{deviceKey}</Secret></code>}
          {keyState && keyState.keys.length > 0 && <ul className="key-list">{keyState.keys.map(k => <li key={k.id}>
            <KeyRound size={14}/><span>{k.label}</span><span className="mono muted" dir="ltr">…{k.hint}</span>
            {k.retireAt ? <span className="key-retiring">{t.keys.retiring(`${dateFormat(k.retireAt, lang)} ${timeFormat(k.retireAt)}`)}</span>
              : k.replaces ? <span className="key-new">{t.keys.waiting}</span>
              : <button type="button" className="text-button" onClick={() => rotateKey(k.id)}><RefreshCw size={13}/>{t.keys.rotate}</button>}
            <button type="button" className="text-button" onClick={() => api.revokeKey(k.id).then(s => { setKeyState(s); notify(t.keys.removed); })}>{t.keys.remove}</button>
          </li>)}</ul>}
          {!deviceKey && <button type="button" className="button primary" onClick={createKey}><KeyRound size={15}/>{t.keys.create}</button>}
        </div> : <p className="callout"><CircleAlert size={16}/>{t.keys.adminOnly}</p>}
        <p>{c.codeIntro}</p>
        <div className="form-grid">
          <label>{c.ssid}<SecretInput label={c.ssid} dir="ltr" autoComplete="off" value={ssid} onChange={e => setSsid(e.target.value)}/></label>
          <label>{c.password}<span className="password-field">
            <input dir="ltr" type={showPw ? 'text' : 'password'} autoComplete="off" value={password} onChange={e => setPassword(e.target.value)}/>
            <button type="button" className="icon-button" onClick={() => setShowPw(v => !v)} aria-pressed={showPw} aria-label={showPw ? t.auth.hide : t.auth.show}>{showPw ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
          </span></label>
        </div>
        <p className="hint server-line">{c.server}: <code dir="ltr"><Secret label={t.secret.address}>{apiUrl}</Secret></code></p>
        <div className="code-tools">
          <span className="mono code-name" dir="ltr">kelvin_esp32.ino</span>
          <button type="button" className="button" onClick={download}><Download size={15}/>{c.download}</button>
          <button type="button" className={`button primary ${copied ? 'is-done' : ''}`} onClick={copy}>{copied ? <Check size={15}/> : <Copy size={15}/>}{copied ? c.copiedShort : c.copy}</button>
        </div>
        <div className="code-box">
          <SecretBlock label={t.secret.code}><pre dir="ltr">{code}</pre></SecretBlock>
        </div>
        <p className="hint">{c.codeNote}</p>
      </>}

      {step === 4 && <>
        <ol className="sub-steps">{c.uploadSteps.map(s => <li key={s}>{s}</li>)}</ol>
        <p className="callout"><CircleAlert size={16}/>{c.stuck}</p>
        <h4 className="fix-head">{c.fixTitle}</h4>
        <dl className="fix-list">{c.fixes.map(([k, v]) => <div key={k}><dt className="mono" dir="ltr">{k}</dt><dd>{v}</dd></div>)}</dl>
      </>}

      {step === 5 && <>
        <p>{c.checkIntro}</p>
        <div className={`live-check ${fresh ? 'ok' : ''}`}>
          {fresh && latest ? <>
            <p><Check size={17}/>{c.arrived(t.ago(Math.max(0, Math.round((now - latest.timestamp) / 1000))))}</p>
            <p className="mono" dir="ltr">{metrics.map(m => `${fmt(m, latest[m])} ${metricInfo[m].unit}`).join('  ·  ')}</p>
          </> : <p><span className="pulse-dot" aria-hidden="true"/>{c.waiting}</p>}
        </div>
        <p className="hint">{c.warmup}</p>
        <button type="button" className="button primary" onClick={onShowLive}>{c.showLive}</button>
      </>}
    </section>

    <div className="step-nav">
      <button type="button" className="button" disabled={step === 0} onClick={() => setStep(s => s - 1)}>{c.back}</button>
      {step < last && <button type="button" className="button primary" onClick={() => setStep(s => s + 1)}>{c.next}</button>}
    </div>
  </div>;
}
