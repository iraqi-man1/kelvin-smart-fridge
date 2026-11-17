import { test, expect } from '@playwright/test';

// The dashboard needs a signed-in user; each test gets its own account.
test.beforeEach(async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await page.request.post('/api/auth/register', { data: { name: 'E2E Student', email, password: 'e2e-password' } });
  expect(res.status()).toBe(201);
});

test('dashboard charts, history search, and CSV export work without a device', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'نظرة عامة', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'وضع تجريبي', exact: true })).toBeVisible();
  const period = page.getByRole('button', { name: 'ساعة', exact: true });
  await period.click(); await expect(period).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: 'ثاني أكسيد الكربون المكافئ خلال الفترة المحددة' })).toBeVisible();
  await page.getByRole('button', { name: '6 ساعات', exact: true }).click();
  await page.screenshot({ path: 'artifacts/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'عرض السجل', exact: true }).click();
  await page.getByRole('textbox', { name: 'بحث في القراءات' }).fill('not-a-real-value');
  await expect(page.getByText('لا توجد نتائج تطابق البحث.')).toBeVisible();
  await page.getByRole('textbox', { name: 'بحث في القراءات' }).fill('');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تصدير CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('kelvin-demo');
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('eCO2 (ppm)'); expect(csv).toContain('DEMO');
  expect(errors).toEqual([]);
});

test('settings persist and reevaluate alert thresholds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('اسم الجهاز').fill('محطة الاختبار');
  await dialog.getByLabel('الحد الأعلى لـ eCO2 (ppm)').fill('400');
  await dialog.getByLabel('فترة تحديث الداشبورد').selectOption('2');
  await dialog.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(page.getByText('تجاوز الحد: eCO2')).toBeVisible();
  await expect(page.getByText('محطة الاختبار', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('محطة الاختبار', { exact: true })).toBeVisible();
  await expect(page.locator('.status-strip').getByText('2', { exact: true })).toBeVisible();
  await expect(page.getByText('تجاوز الحد: eCO2')).toBeVisible();
});

test('demo alerts can be triggered and marked read', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'التنبيهات', exact: true }).click();
  // The demo history already holds one door-open alert.
  await expect(page.locator('.nav-count')).toHaveText('1');
  await page.getByRole('button', { name: 'محاكاة تجاوز' }).click();
  await expect(page.getByRole('heading', { name: 'ارتفاع درجة الحرارة' }).first()).toBeVisible();
  await expect(page.locator('.nav-count')).toHaveText('2');
  await page.getByRole('button', { name: 'تعليم الكل كمقروء' }).click();
  await expect(page.locator('.nav-count')).toHaveCount(0);
});

test('real device data is validated, converted, and kept separate from demo data', async ({ page, request }) => {
  const invalid = await request.post('/api/readings', { data: { temperature: 25, humidity: 101, eco2: 600, tvoc: 30 } });
  expect(invalid.status()).toBe(400);
  const before = (await (await request.get('/api/readings')).json()).readings.length;
  const posted = await Promise.all(Array.from({ length: 3 }, (_, i) => request.post('/api/readings', { data: { temperature: 23 + i, humidity: 42 + i, eco2: 650 + i * 10, tvoc: 40 + i, rssi: -60, deviceId: 'ESP32-WROOM-32' } })));
  for (const response of posted) expect(response.status()).toBe(201);
  const after = (await (await request.get('/api/readings')).json()).readings;
  expect(after.length).toBe(before + 3);
  expect(after.at(-1).eco2).toBeGreaterThanOrEqual(650);
  await page.goto('/');
  await page.getByRole('button', { name: 'وضع تجريبي', exact: true }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'جهاز ESP32' }).click();
  await page.getByRole('button', { name: 'العودة إلى اللوحة' }).click();
  await expect(page.getByRole('button', { name: 'ربط مباشر', exact: true })).toBeVisible();
  await expect(page.getByText('الاتصال بالجهاز نشط')).toBeVisible();
  await expect(page.locator('.readings-panel tbody tr')).toHaveCount(Math.min(5, after.length));
  await expect(page.locator('.metric-card.eco2 .metric-value strong')).toHaveText(String(after.at(-1).eco2));
  expect(await page.locator('body').innerText()).not.toContain('Demo Network');
});

test('mobile menu, settings dialog, and layout fit a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'نظرة عامة', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.getByRole('button', { name: 'الحساسات', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'الحساسات', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.mobile-bar').getByRole('button', { name: 'الإعدادات' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('dialog').getBoundingClientRect().width < innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('language switch changes text and direction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: 'BM', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gambaran keseluruhan', level: 1 })).toBeVisible();
  await expect(page.getByText('ALSARRAY ALI AHMED ALI').first()).toBeVisible();
});

test('profile can be edited and the user can sign out', async ({ page }) => {
  await page.goto('/');
  await page.locator('.user-chip').click();
  await expect(page.getByRole('heading', { name: 'حسابي', level: 1 })).toBeVisible();
  await page.getByLabel('الرقم الجامعي').fill('22301234');
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(page.locator('.profile-facts')).toContainText('22301234');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByRole('heading', { name: 'سجّل دخولك إلى اللوحة' })).toBeVisible();
  expect((await page.request.get('/api/readings')).status()).toBe(401);
});
