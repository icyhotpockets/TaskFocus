import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startStaticServer } from './static-server.mjs';

const server = await startStaticServer({ root: 'www', port: 0 });
const address = server.address();
assert(address && typeof address === 'object', 'Static server did not bind');
const origin = `http://127.0.0.1:${address.port}`;

let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const failures = [];

  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

  await page.goto(`${origin}/index.html#tasks`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#view').waitFor({ state: 'visible' });
  await assert.doesNotReject(() => page.locator('.tabbar .tab').evaluateAll((tabs) => {
    if (tabs.length !== 3) throw new Error(`Expected 3 tabs, found ${tabs.length}`);
  }));
  await page.locator('#fab').waitFor({ state: 'visible' });

  await page.locator('#fab').tap();
  await page.locator('#quick-task-input').fill('Pay rent tomorrow 5pm every 30m high #bills');
  await page.locator('#parsed-preview').getByText('every 30m').waitFor();
  await page.locator('[data-action="add-task"]').tap();
  await page.getByText('Pay rent', { exact: true }).first().waitFor();

  // Persistence is debounced; wait before proving a full reload keeps the task.
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Pay rent', { exact: true }).first().waitFor();

  await page.locator('[data-route="calendar"]').tap();
  await page.waitForFunction(() => location.hash === '#calendar');
  await page.getByRole('heading', { name: 'Calendar' }).waitFor();

  await page.locator('[data-route="settings"]').tap();
  await page.waitForFunction(() => location.hash === '#settings');
  await page.locator('[data-action="theme-family"][data-family="calm"]').tap();
  await page.locator('[data-action="theme"][data-theme="eucalyptus"]').tap();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#ebeddb');
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'eucalyptus');

  await page.locator('[data-route="tasks"]').tap();
  await page.waitForFunction(() => location.hash === '#tasks');
  await page.getByText('Pay rent', { exact: true }).first().waitFor();

  assert.deepEqual(failures, [], failures.join('\n'));
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
