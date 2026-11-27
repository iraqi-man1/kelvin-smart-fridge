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
  return String.raw`// Kelvin — ESP32 + DHT11 + CCS811 + OLED
// One reading is sent every 1 h 30 min, on fixed times (00:00, 01:30, 03:00 ...).
// The server says when the next one is due; the OLED shows live values in between.
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
const unsigned long RETRY_MS = 60000;   // after a failed send, try again in 1 minute

#define DHT_PIN    27   // DHT11 data (S / OUT). If nothing answers here, the code looks on other pins at start.
#define SDA_PIN    33   // I2C data: OLED SDA and CCS811 SDA
#define SCL_PIN    32   // I2C clock: OLED SCL and CCS811 SCL
// Pins tried when the DHT11 does not answer on DHT_PIN (never the I2C pins).
const int DHT_SEARCH[] = { DHT_PIN, 27, 4, 13, 14, 15, 18, 19, 21, 22, 23, 5 };
DHT* dht = nullptr;
int dhtPin = DHT_PIN;
float lastT = NAN, lastH = NAN;   // the last good DHT11 reading
unsigned long lastGoodDht = 0;
int dhtFails = 0;
Adafruit_CCS811 ccs;                          // I2C: SDA = GPIO 33, SCL = GPIO 32, WAK and ADD -> GND
Adafruit_SSD1306 oled(128, 64, &Wire, -1);    // OLED on the same I2C bus, address 0x3C
bool hasOled = false;
unsigned long lastScreen = 0, lastDhtRead = 0;
void showStatus(const char* line1, const char* line2 = "");   // defined further down
int lastCode = 0;             // the server's last answer (201 = reading saved, 200 = slot already had one)
uint16_t eco2 = 400, tvoc = 0;
unsigned long lastSend = 0;
unsigned long waitMs = 0;     // until the next send; 0 = send now (right after power-on)

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  showStatus("Connecting to Wi-Fi", WIFI_NAME);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.print("\nConnected, IP: ");
  Serial.println(WiFi.localIP());
  showStatus("Wi-Fi connected", WiFi.localIP().toString().c_str());
}

// One DHT11 reading, tried up to 3 times (the ESP32's Wi-Fi sometimes spoils one read).
bool readDht(DHT& sensor, float& t, float& h) {
  for (int i = 0; i < 3; i++) {
    h = sensor.readHumidity(true);      // true = a fresh read, not the cached one
    t = sensor.readTemperature();       // from that same read
    if (!isnan(t) && !isnan(h)) return true;
    delay(1200);                        // the DHT11 needs over a second between reads
  }
  return false;
}

// At start: check the DHT11 on DHT_PIN; if it is silent, look for it on the other pins.
void findDht() {
  Serial.printf("DHT11: checking GPIO %d...\n", DHT_PIN);
  for (int pin : DHT_SEARCH) {
    DHT probe(pin, DHT11);
    probe.begin();
    delay(2000);                        // time to wake up after power-on
    float t, h;
    if (readDht(probe, t, h)) {
      dhtPin = pin;
      Serial.printf("DHT11 found on GPIO %d: %.1f C, %.0f%%\n", pin, t, h);
      if (pin != DHT_PIN) Serial.printf(">> Your DHT11 data wire is on GPIO %d, not %d. The code uses %d now.\n", pin, DHT_PIN, pin);
      lastT = t; lastH = h; lastGoodDht = millis();
      break;
    }
    if (pin == DHT_PIN) Serial.println("DHT11: no answer on that pin. Looking on the other pins (about 30 s)...");
  }
  if (!lastGoodDht) Serial.println("DHT11 NOT FOUND. Check: + to 3V3, - to GND, S/OUT to GPIO 27 (a bare 4-pin DHT11 also needs a 10k resistor from data to 3V3).");
  dht = new DHT(dhtPin, DHT11);
  dht->begin();
}

// A start-up line on the screen ("Wi-Fi...", "DHT11 on GPIO 27"), so it is never black.
void showStatus(const char* line1, const char* line2) {
  Serial.println(line1);
  if (!hasOled) return;
  oled.clearDisplay();
  oled.setTextSize(2); oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0); oled.print("Kelvin");
  oled.setTextSize(1);
  oled.setCursor(0, 28); oled.print(line1);
  oled.setCursor(0, 42); oled.print(line2);
  oled.display();
}

// The readings screen, redrawn every 2 seconds whether or not the DHT11 answered.
void showOnScreen() {
  if (!hasOled) return;
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.print("Kelvin ");
  oled.print(WiFi.status() == WL_CONNECTED ? ((lastCode == 200 || lastCode == 201) ? "online" : "Wi-Fi ok") : "no Wi-Fi");
  oled.setCursor(0, 14);
  if (isnan(lastT)) oled.print("Temp --   Hum --");
  else oled.printf("Temp %.1f C  Hum %.0f%%", lastT, lastH);
  oled.setCursor(0, 26); oled.printf("eCO2 %u ppm", eco2);
  oled.setCursor(0, 38); oled.printf("TVOC %u ppb", tvoc);
  oled.setCursor(0, 52);
  if (lastSend && waitMs > RETRY_MS) oled.printf("next send in %lu min", (waitMs - (millis() - lastSend)) / 60000 + 1);
  oled.display();
}

// Lists what answers on the I2C bus: 0x3C/0x3D = OLED, 0x5A/0x5B = CCS811.
void scanI2C() {
  Serial.printf("I2C scan (SDA GPIO %d, SCL GPIO %d):\n", SDA_PIN, SCL_PIN);
  int found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  found 0x%02X %s\n", a, a == 0x3C || a == 0x3D ? "(OLED)" : a == 0x5A || a == 0x5B ? "(CCS811)" : "");
      found++;
    }
  }
  if (!found) Serial.println("  nothing found: check SDA/SCL wires, 3V3 and GND of the OLED and CCS811.");
}

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);
  if (!ccs.begin()) Serial.println("CCS811 not found. Check SDA/SCL and WAK -> GND.");
  scanI2C();
  hasOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C) || oled.begin(SSD1306_SWITCHCAPVCC, 0x3D);
  if (!hasOled) Serial.println("OLED not found. Check its SDA (GPIO 33), SCL (GPIO 32), VCC and GND.");
  showStatus("Starting...", "Looking for DHT11");
  findDht();                  // before Wi-Fi starts, so nothing disturbs the search
  if (lastGoodDht) { char line[24]; snprintf(line, sizeof line, "DHT11 on GPIO %d", dhtPin); showStatus(line, "OK"); }
  else showStatus("DHT11 not found", "check its wires");
  WiFi.mode(WIFI_STA);
  connectWiFi();
}

void loop() {
  connectWiFi();
  if (millis() - lastScreen >= 2000) {
    lastScreen = millis();
    if (ccs.available() && !ccs.readData()) { eco2 = ccs.geteCO2(); tvoc = ccs.getTVOC(); }
    // The DHT11 is read every 10 s for the screen; a send uses the freshest good value.
    if (millis() - lastDhtRead >= 10000) {
      lastDhtRead = millis();
      float t, h;
      if (readDht(*dht, t, h)) { lastT = t; lastH = h; lastGoodDht = millis(); dhtFails = 0; }
    }
    showOnScreen();
  }
  if (lastSend && millis() - lastSend < waitMs) { delay(20); return; }
  lastSend = millis();
  waitMs = RETRY_MS;          // replaced by the server's answer when the send works

  float t, h;
  if (readDht(*dht, t, h)) {
    lastT = t; lastH = h; lastGoodDht = millis(); dhtFails = 0;
  } else {
    dhtFails++;
    Serial.printf("DHT11 read failed on GPIO %d (%d in a row).\n", dhtPin, dhtFails);
    // A short miss: send the last good values (read in the last 2 minutes).
    if (!lastGoodDht || millis() - lastGoodDht > 120000UL) {
      Serial.println("No good DHT11 reading for 2 minutes: nothing sent, trying again in 1 minute. Check the wiring.");
      return;
    }
    t = lastT; h = lastH;
  }
  if (ccs.available() && !ccs.readData()) {
    eco2 = ccs.geteCO2();
    tvoc = ccs.getTVOC();
    ccs.setEnvironmentalData(h, t);   // improves the CCS811 estimate
  }

  String body = String("{\"temperature\":") + String(t, 1) +
                ",\"humidity\":" + String(h, 1) +
                ",\"eco2\":" + eco2 + ",\"tvoc\":" + tvoc +
                ",\"deviceId\":\"ESP32-WROOM-32\",\"rssi\":" + WiFi.RSSI() +
                ",\"uptime\":" + (millis() / 1000) + "}";

  HTTPClient http;
  WiFiClientSecure secure;   // for an https:// server (the site online)
  if (strncmp(SERVER_URL, "https", 5) == 0) { secure.setInsecure(); http.begin(secure, SERVER_URL); }
  else http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_KEY)) http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(body);
  lastCode = code;
  Serial.printf("Sent %s -> %d\n", body.c_str(), code);
  if (code == 200 || code == 201) {
    JsonDocument reply;
    long nextIn = 0;
    if (!deserializeJson(reply, http.getString())) nextIn = reply["nextIn"] | 0;
    // Wait for the next 1 h 30 min slot (plus 5 s, so the send lands inside it).
    waitMs = (nextIn > 0 && nextIn <= 5400) ? (unsigned long)nextIn * 1000UL + 5000UL : 5400000UL;
    if (code == 201) Serial.printf("Reading saved. Next one in %lu min.\n", waitMs / 60000);
    else Serial.printf("This 1 h 30 min slot already has a reading. Next one in %lu min.\n", waitMs / 60000);
  } else if (code == 401) {
    Serial.println("The server refused the device key. Copy the code again from Connect device.");
  } else {
    Serial.println("Send failed: trying again in 1 minute.");
  }
  http.end();
  showOnScreen();
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
  const [seen, setSeen] = useState<number | null>(null); // the device's last check-in
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
    // A check-in shows the device is talking to the server; a reading is kept only once
    // every 1 h 30 min, so the last saved one may be older.
    const poll = () => {
      if (document.hidden) return;
      api.device().then(d => setSeen(d.lastSeen ?? null)).catch(() => {});
      fetch(`/api/readings?since=${Date.now() - 2 * 5400000}`).then(r => r.json()).then(b => { setLatest(b.readings?.at(-1) ?? null); setNow(Date.now()); }).catch(() => {});
    };
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
    ['DHT11 +', '3V3'], ['DHT11 S / OUT', 'GPIO 27'], ['DHT11 −', 'GND'],
    ['CCS811 VCC', '3V3'], ['CCS811 GND', 'GND'], ['CCS811 SDA', 'GPIO 33'], ['CCS811 SCL', 'GPIO 32'], ['CCS811 WAK', 'GND'], ['CCS811 ADD', 'GND'],
    ['OLED VCC', '3V3'], ['OLED GND', 'GND'], ['OLED SDA', 'GPIO 33'], ['OLED SCL', 'GPIO 32'],
  ];
  const fresh = seen !== null && now - seen < 60000;

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
          {fresh && seen !== null ? <>
            <p><Check size={17}/>{c.arrived(t.ago(Math.max(0, Math.round((now - seen) / 1000))))}</p>
            {latest && <p className="mono" dir="ltr">{metrics.map(m => `${fmt(m, latest[m])} ${metricInfo[m].unit}`).join('  ·  ')}</p>}
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
