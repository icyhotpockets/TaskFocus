import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startStaticServer } from './static-server.mjs';

const server = await startStaticServer({ root: 'www', port: 0 });
const address = server.address();
assert(address && typeof address === 'object', 'Static server did not bind');
const origin = `http://127.0.0.1:${address.port}`;

let browser;

async function seedFilterFixtures(page) {
  await page.evaluate(async () => {
    const {
      STORAGE_KEY,
      migrateData,
      withAddedTask,
    } = await import(new URL('./js/core/data.js', location.href).href);
    let data = migrateData(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    const fixtures = [
      { title: 'Rose bills', color: '#c4576a', tags: ['bills', 'home'], priority: 0 },
      { title: 'Rose work', color: '#c4576a', tags: ['work'], priority: 0 },
      { title: 'Ember bills', color: '#d96c47', tags: ['bills'], priority: 0 },
    ];
    for (const fixture of fixtures) data = withAddedTask(data, fixture);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  });
  await page.reload({ waitUntil: 'networkidle' });
}

async function expectTaskMatches(page, { visible = [], hidden = [] }) {
  await page.waitForFunction(({ visibleTitles, hiddenTitles }) => {
    const titles = [...document.querySelectorAll('.task-title')].map((node) => node.textContent?.trim());
    return visibleTitles.every((title) => titles.includes(title))
      && hiddenTitles.every((title) => !titles.includes(title));
  }, { visibleTitles: visible, hiddenTitles: hidden });
}

async function openTaskOption(dialog, option) {
  const button = dialog.locator(`[data-action="task-option"][data-option="${option}"]`);
  await button.tap();
  const panel = dialog.locator(`[data-option-panel="${option}"]`);
  await panel.waitFor({ state: 'visible' });
  assert.equal(await dialog.locator('[data-option-panel]:visible').count(), 1, 'Only one task option panel should be open');
  assert.match(await button.getAttribute('class'), /\bopen\b/, `${option} chip should show its open state`);
  return panel;
}

async function importBackupFile(page, contents, name = 'taskfocus-backup.json') {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-backup"]').tap();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(contents),
  });
}

async function runNativeNotificationSmoke(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    const state = {
      permission: 'prompt',
      exact: 'prompt',
      pending: [],
      registeredActionTypes: null,
      channel: null,
      actionListener: null,
      resumeListener: null,
    };
    globalThis.__nativeNotifications = state;
    globalThis.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        LocalNotifications: {
          registerActionTypes: async (options) => { state.registeredActionTypes = options; },
          createChannel: async (options) => { state.channel = options; },
          checkPermissions: async () => ({ display: state.permission }),
          requestPermissions: async () => ({ display: (state.permission = 'granted') }),
          checkExactNotificationSetting: async () => ({ exact_alarm: state.exact }),
          changeExactNotificationSetting: async () => ({ exact_alarm: (state.exact = 'granted') }),
          getPending: async () => ({ notifications: state.pending }),
          cancel: async ({ notifications }) => {
            const ids = new Set(notifications.map(({ id }) => id));
            state.pending = state.pending.filter(({ id }) => !ids.has(id));
          },
          schedule: async ({ notifications }) => {
            const ids = new Set(notifications.map(({ id }) => id));
            state.pending = [
              ...state.pending.filter(({ id }) => !ids.has(id)),
              ...notifications,
            ];
            return { notifications: notifications.map(({ id }) => ({ id })) };
          },
          addListener: async (name, listener) => {
            if (name === 'localNotificationActionPerformed') state.actionListener = listener;
            return { remove: async () => undefined };
          },
        },
        App: {
          addListener: async (name, listener) => {
            if (name === 'resume') state.resumeListener = listener;
            return { remove: async () => undefined };
          },
        },
      },
    };
  });

  const page = await context.newPage();
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`native console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`native pageerror: ${error.message}`));

  await page.goto(`${origin}/index.html#settings`, { waitUntil: 'networkidle' });
  await page.locator('[data-action="enable-notifications"]').tap();
  await page.getByRole('button', { name: 'Enabled', exact: true }).waitFor();
  await page.locator('[data-action="exact-notifications"]').tap();
  await page.getByRole('button', { name: 'Allowed', exact: true }).waitFor();

  const bridgeSetup = await page.evaluate(() => ({
    channel: globalThis.__nativeNotifications.channel,
    registeredActionTypes: globalThis.__nativeNotifications.registeredActionTypes,
    hasActionListener: typeof globalThis.__nativeNotifications.actionListener === 'function',
    hasResumeListener: typeof globalThis.__nativeNotifications.resumeListener === 'function',
  }));
  assert.equal(bridgeSetup.channel.importance, 5);
  assert.equal(bridgeSetup.registeredActionTypes.types.length, 2);
  assert.equal(bridgeSetup.hasActionListener, true);
  assert.equal(bridgeSetup.hasResumeListener, true);

  await page.locator('#fab').tap();
  await page.locator('#quick-task-input').fill('Native reminder tomorrow 5pm every 30m');
  await page.locator('[data-action="add-task"]').tap();
  await page.getByText('Native reminder', { exact: true }).first().waitFor();
  await page.waitForFunction(() => globalThis.__nativeNotifications.pending.some(({ id }) => id !== 999001));

  const taskId = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('taskfocus.data.v1'));
    return data.tasks.find(({ title }) => title === 'Native reminder').id;
  });
  assert.ok(taskId > 0);

  await page.locator('[data-route="settings"]').tap();
  await page.locator('[data-action="test-notification"]').tap();
  await page.waitForFunction(() => globalThis.__nativeNotifications.pending.some(({ id }) => id === 999001));

  const snoozeStartedAt = Date.now();
  await page.evaluate(async (id) => {
    await globalThis.__nativeNotifications.actionListener({
      actionId: 'snooze',
      notification: { id: id * 100, extra: { taskId: id } },
    });
  }, taskId);
  const snoozedStartAt = await page.evaluate((id) => {
    const data = JSON.parse(localStorage.getItem('taskfocus.data.v1'));
    return data.tasks.find(({ id: candidateId }) => candidateId === id).reminder.startAt;
  }, taskId);
  assert.ok(snoozedStartAt >= snoozeStartedAt + 59 * 60_000, 'Snooze should move the reminder about one hour');

  await page.evaluate(async (id) => {
    await globalThis.__nativeNotifications.actionListener({
      actionId: 'done',
      notification: { id: id * 100, extra: { taskId: id } },
    });
  }, taskId);
  const completed = await page.evaluate((id) => {
    const data = JSON.parse(localStorage.getItem('taskfocus.data.v1'));
    return data.tasks.find(({ id: candidateId }) => candidateId === id);
  }, taskId);
  assert.ok(completed.completedAt);
  assert.equal(completed.archived, true);
  assert.deepEqual(
    await page.evaluate(() => globalThis.__nativeNotifications.pending.map(({ id }) => id)),
    [999001],
    'Completing from the notification should cancel the task alarms while preserving the test alert',
  );

  assert.deepEqual(failures, [], failures.join('\n'));
  await context.close();
}

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

  // Parsed chips are real controls: removing a due token keeps it cleared as the source changes.
  await page.locator('#fab').tap();
  let parsedEditor = page.locator('#sheets [role="dialog"]');
  await parsedEditor.locator('#quick-task-input').fill('Review tomorrow 9am #plan');
  const parsedDue = parsedEditor.locator('[data-action="remove-parsed"][data-type="due"]');
  await parsedDue.waitFor({ state: 'visible' });
  await parsedDue.tap();
  await parsedDue.waitFor({ state: 'detached' });
  await parsedEditor.locator('#quick-task-input').fill('Review tomorrow 9am soon #plan');
  assert.equal(
    await parsedEditor.locator('[data-action="remove-parsed"][data-type="due"]').count(),
    0,
    'A manually removed due token must not be re-parsed while editing the source',
  );
  await parsedEditor.locator('[data-action="add-task"]').tap();
  await page.getByText('Review tomorrow 9am soon', { exact: true }).first().waitFor();
  await page.waitForTimeout(900);
  const parsedRemovalTask = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('taskfocus.data.v1'));
    return data.tasks.find((task) => task.title === 'Review tomorrow 9am soon');
  });
  assert.equal(parsedRemovalTask.due, null);
  assert.deepEqual(parsedRemovalTask.tags, ['plan']);

  // Home filter chips: selection is live, OR within a kind, and AND across kinds.
  await seedFilterFixtures(page);
  await page.locator('[data-action="open-category-filter"]').tap();
  let filterDialog = page.locator('#sheets [role="dialog"]');
  await filterDialog.getByRole('heading', { name: /category/i }).waitFor();
  await filterDialog.locator('[data-action="toggle-filter-color"][data-filter-color="#c4576a"]').tap();
  await expectTaskMatches(page, {
    visible: ['Rose bills', 'Rose work'],
    hidden: ['Pay rent', 'Ember bills'],
  });
  await page.waitForFunction(() => document.querySelector('[data-action="open-category-filter"]')?.textContent.includes('1'));
  await filterDialog.locator('[data-action="filter-done"]').tap();
  await filterDialog.waitFor({ state: 'detached' });

  await page.locator('[data-action="open-tag-filter"]').tap();
  filterDialog = page.locator('#sheets [role="dialog"]');
  await filterDialog.getByRole('heading', { name: /tags/i }).waitFor();
  const tagSearch = filterDialog.locator('[data-filter-search="tags"]');
  await tagSearch.fill('bill');
  await filterDialog.locator('[data-action="toggle-filter-tag"][data-filter-tag="bills"]').waitFor({ state: 'visible' });
  assert.equal(
    await filterDialog.locator('[data-action="toggle-filter-tag"][data-filter-tag="work"]:visible').count(),
    0,
    'Tag search should filter chips live',
  );
  await filterDialog.locator('[data-action="toggle-filter-tag"][data-filter-tag="bills"]').tap();
  await expectTaskMatches(page, { visible: ['Rose bills'], hidden: ['Rose work', 'Ember bills', 'Pay rent'] });
  await tagSearch.fill('');
  await filterDialog.locator('[data-action="toggle-filter-tag"][data-filter-tag="work"]').tap();
  await expectTaskMatches(page, { visible: ['Rose bills', 'Rose work'], hidden: ['Ember bills', 'Pay rent'] });
  await page.waitForFunction(() => document.querySelector('[data-action="open-tag-filter"]')?.textContent.includes('2'));
  await filterDialog.locator('[data-action="filter-done"]').tap();
  await filterDialog.waitFor({ state: 'detached' });

  // Clear affects the currently open filter kind, leaving the other kind active.
  await page.locator('[data-action="open-tag-filter"]').tap();
  filterDialog = page.locator('#sheets [role="dialog"]');
  await filterDialog.locator('[data-action="clear-filters"]').tap();
  await expectTaskMatches(page, { visible: ['Rose bills', 'Rose work'], hidden: ['Ember bills', 'Pay rent'] });
  await filterDialog.locator('[data-action="filter-done"]').tap();
  await page.locator('[data-action="open-category-filter"]').tap();
  filterDialog = page.locator('#sheets [role="dialog"]');
  await filterDialog.locator('[data-action="clear-filters"]').tap();
  await expectTaskMatches(page, { visible: ['Pay rent', 'Rose bills', 'Rose work', 'Ember bills'] });
  await filterDialog.locator('[data-action="filter-done"]').tap();

  // Add editor: every toolbar chip must open from a touch tap while the keyboard input is focused.
  await page.locator('#fab').tap();
  let editor = page.locator('#sheets [role="dialog"]');
  const quickInput = editor.locator('#quick-task-input');
  await quickInput.fill('Configured task');
  assert.equal(await quickInput.evaluate((input) => input === document.activeElement), true);

  let optionPanel = await openTaskOption(editor, 'date');
  await optionPanel.locator('[data-field="due-date"]').fill('2026-08-20');
  await optionPanel.locator('[data-field="due-time"]').fill('14:30');

  optionPanel = await openTaskOption(editor, 'timing');
  for (const name of [/Notify me every/i, /Task timer/i, /Breaks/i]) {
    const control = optionPanel.getByRole('switch', { name });
    await control.tap();
    assert.equal(await control.isChecked(), true, `${name} should turn on`);
  }
  await optionPanel.locator('[data-field="interval-min"]').fill('45');
  await optionPanel.locator('[data-field="timer-min"]').fill('50');
  await optionPanel.locator('[data-field="work-min"]').fill('20');
  await optionPanel.locator('[data-field="break-min"]').fill('10');

  optionPanel = await openTaskOption(editor, 'priority');
  await optionPanel.locator('[data-action="set-draft-priority"][data-priority="2"]').tap();
  optionPanel = await openTaskOption(editor, 'color');
  await optionPanel.locator('[data-action="set-draft-color"][data-color="#4a9e8f"]').tap();
  optionPanel = await openTaskOption(editor, 'tags');
  await optionPanel.locator('[data-field="tags"]').fill('launch, Team');
  optionPanel = await openTaskOption(editor, 'notes');
  await optionPanel.locator('[data-field="notes"]').fill('Bring the launch checklist.');
  await editor.locator('[data-action="add-task"]').tap();
  await page.getByText('Configured task', { exact: true }).first().waitFor();

  await page.waitForTimeout(900);
  let configured = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('taskfocus.data.v1'));
    return data.tasks.find((task) => task.title === 'Configured task');
  });
  assert.equal(configured.notes, 'Bring the launch checklist.');
  assert.equal(configured.priority, 2);
  assert.equal(configured.color, '#4a9e8f');
  assert.deepEqual(configured.tags, ['launch', 'team']);
  assert.deepEqual(configured.reminder, { intervalMin: 45, startAt: null });
  assert.deepEqual(configured.timer, { durationMin: 50 });
  assert.deepEqual(configured.breaks, { workMin: 20, breakMin: 10 });
  assert.equal(configured.allDay, false);
  assert.ok(Number.isFinite(configured.due));
  assert.equal(new Date(configured.due).getFullYear(), 2026);
  assert.equal(new Date(configured.due).getMonth(), 7);
  assert.equal(new Date(configured.due).getDate(), 20);
  assert.equal(new Date(configured.due).getHours(), 14);
  assert.equal(new Date(configured.due).getMinutes(), 30);

  // Edit editor: saved values return to their panels and changes persist.
  await page.getByText('Configured task', { exact: true }).first().tap();
  editor = page.locator('#sheets [role="dialog"]');
  await editor.getByRole('heading', { name: 'Edit task' }).waitFor();
  optionPanel = await openTaskOption(editor, 'date');
  assert.equal(await optionPanel.locator('[data-field="due-date"]').inputValue(), '2026-08-20');
  assert.equal(await optionPanel.locator('[data-field="due-time"]').inputValue(), '14:30');
  await optionPanel.locator('[data-action="remove-parsed"][data-type="due"]').tap();
  assert.equal(await editor.locator('#edit-task-title').inputValue(), 'Configured task', 'Clearing a date must preserve the edit title');
  assert.equal(await optionPanel.locator('[data-field="due-date"]').inputValue(), '');
  assert.equal(await optionPanel.locator('[data-field="due-time"]').inputValue(), '');
  optionPanel = await openTaskOption(editor, 'timing');
  assert.equal(await optionPanel.getByRole('switch', { name: /Notify me every/i }).isChecked(), true);
  optionPanel = await openTaskOption(editor, 'priority');
  await optionPanel.locator('[data-action="set-draft-priority"][data-priority="0"]').tap();
  optionPanel = await openTaskOption(editor, 'color');
  await optionPanel.locator('[data-action="set-draft-color"][data-color="#c4576a"]').tap();
  optionPanel = await openTaskOption(editor, 'tags');
  await optionPanel.locator('[data-field="tags"]').fill('revised');
  optionPanel = await openTaskOption(editor, 'notes');
  await optionPanel.locator('[data-field="notes"]').fill('Updated through the Notes chip.');
  await editor.locator('[data-action="save-edit"]').tap();
  await page.waitForTimeout(900);
  configured = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('taskfocus.data.v1'));
    return data.tasks.find((task) => task.title === 'Configured task');
  });
  assert.equal(configured.priority, 0);
  assert.equal(configured.color, '#c4576a');
  assert.deepEqual(configured.tags, ['revised']);
  assert.equal(configured.notes, 'Updated through the Notes chip.');
  assert.equal(configured.due, null);
  assert.equal(configured.allDay, false);

  // Timer-equipped tasks start and stop a focus session; completed cards never offer Play.
  let configuredCard = page.locator('.task-card').filter({ hasText: 'Configured task' }).first();
  await configuredCard.getByRole('button', { name: 'Start focus session' }).tap();
  await configuredCard.getByRole('button', { name: 'Stop focus session' }).waitFor();
  await configuredCard.locator('.chip.progress').waitFor();
  await configuredCard.getByRole('button', { name: 'Stop focus session' }).tap();
  await configuredCard.getByRole('button', { name: 'Start focus session' }).waitFor();
  await configuredCard.getByRole('button', { name: 'Complete Configured task' }).tap();
  const doneDetails = page.locator('details.done-details');
  await doneDetails.locator('summary').tap();
  configuredCard = doneDetails.locator('.task-card').filter({ hasText: 'Configured task' });
  await configuredCard.waitFor({ state: 'visible' });
  assert.equal(
    await configuredCard.locator('[data-action="toggle-session"]').count(),
    0,
    'Completed tasks must not show a focus-session control',
  );

  await page.locator('[data-route="calendar"]').tap();
  await page.waitForFunction(() => location.hash === '#calendar');
  await page.getByRole('heading', { name: 'Calendar' }).waitFor();

  await page.locator('[data-route="settings"]').tap();
  await page.waitForFunction(() => location.hash === '#settings');
  await page.locator('[data-action="theme-family"][data-family="calm"]').tap();
  await page.locator('[data-action="theme"][data-theme="eucalyptus"]').tap();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#ebeddb');

  await page.locator('[data-action="open-quiet-hours"]').tap();
  let settingsDialog = page.locator('#sheets [role="dialog"]');
  await settingsDialog.getByRole('heading', { name: 'Quiet hours' }).waitFor();
  await settingsDialog.locator('#quiet-start').fill('21:15');
  await settingsDialog.locator('#quiet-end').fill('06:45');
  await settingsDialog.locator('[data-action="save-quiet-hours"]').tap();
  await page.getByText('21:15–06:45', { exact: true }).waitFor();
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'eucalyptus');
  await page.getByText('21:15–06:45', { exact: true }).waitFor();

  const savedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('taskfocus.data.v1')).settings);
  assert.equal(savedSettings.quietStart, '21:15');
  assert.equal(savedSettings.quietEnd, '06:45');

  // Export uses the browser download fallback and contains the current complete document.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
  });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-backup"]').tap();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^taskfocus-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadPath = await download.path();
  assert.ok(downloadPath, 'Backup download should have a readable local path');
  const exportedDocument = JSON.parse(await readFile(downloadPath, 'utf8'));
  assert.ok(exportedDocument.tasks.some((task) => task.title === 'Pay rent'));
  assert.equal(exportedDocument.settings.quietStart, '21:15');

  // Invalid imports are rejected without changing the primary document.
  const beforeInvalidImport = await page.evaluate(() => localStorage.getItem('taskfocus.data.v1'));
  await importBackupFile(page, '{not valid json', 'invalid-backup.json');
  await page.getByText('Backup is not valid JSON.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('taskfocus.data.v1')), beforeInvalidImport);

  const importTimestamp = Date.now();
  const backupPayload = (title, settings) => JSON.stringify({
    version: 1,
    meta: { nextTaskId: 2, createdAt: importTimestamp, updatedAt: importTimestamp },
    tasks: [{ id: 1, title, createdAt: importTimestamp }],
    settings,
  });
  const importedSettings = { quietStart: '20:00', quietEnd: '07:00', focusLimit: 3, theme: 'paper' };

  // A valid import is previewed and Cancel leaves the current data untouched.
  await importBackupFile(page, backupPayload('Cancelled import', importedSettings), 'cancel-backup.json');
  let importDialog = page.getByRole('alertdialog');
  await importDialog.getByRole('heading', { name: 'Replace everything?' }).waitFor();
  await importDialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await importDialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('taskfocus.data.v1')), beforeInvalidImport);

  // Keep a UI filter active before import; replacement must clear that transient state too.
  await page.locator('[data-route="tasks"]').tap();
  await page.waitForFunction(() => location.hash === '#tasks');
  await page.locator('[data-action="open-category-filter"]').tap();
  filterDialog = page.locator('#sheets [role="dialog"]');
  await filterDialog.locator('[data-action="toggle-filter-color"][data-filter-color="#c4576a"]').tap();
  await filterDialog.locator('[data-action="filter-done"]').tap();
  await page.waitForFunction(() => document.querySelector('[data-action="open-category-filter"]')?.textContent.includes('1'));
  await page.locator('[data-route="settings"]').tap();
  await page.waitForFunction(() => location.hash === '#settings');

  // Confirm writes synchronously, preserves the old primary as .bak, then survives reload.
  const oldPrimary = await page.evaluate(() => localStorage.getItem('taskfocus.data.v1'));
  await importBackupFile(page, backupPayload('Restored from backup', importedSettings), 'restore-backup.json');
  importDialog = page.getByRole('alertdialog');
  await importDialog.getByRole('heading', { name: 'Replace everything?' }).waitFor();
  await importDialog.locator('[data-action="confirm-import"]').tap();
  const importedStorage = await page.evaluate(() => ({
    primary: localStorage.getItem('taskfocus.data.v1'),
    backup: localStorage.getItem('taskfocus.data.v1.bak'),
  }));
  assert.equal(importedStorage.backup, oldPrimary, 'Import must copy the previous primary document to .bak');
  const importedPrimary = JSON.parse(importedStorage.primary);
  assert.deepEqual(importedPrimary.tasks.map((task) => task.title), ['Restored from backup']);
  assert.equal(importedPrimary.settings.theme, 'paper');

  await page.locator('[data-route="tasks"]').tap();
  await page.waitForFunction(() => location.hash === '#tasks');
  await page.getByText('Restored from backup', { exact: true }).first().waitFor();
  assert.doesNotMatch(
    await page.locator('[data-action="open-category-filter"]').textContent(),
    /·\s*1/,
    'Import must clear active category filters immediately',
  );
  assert.equal(await page.getByText('Pay rent', { exact: true }).count(), 0);
  await page.locator('[data-route="settings"]').tap();
  await page.waitForFunction(() => location.hash === '#settings');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
  await page.getByText('20:00–07:00', { exact: true }).waitFor();

  await page.locator('[data-route="tasks"]').tap();
  await page.waitForFunction(() => location.hash === '#tasks');
  await page.getByText('Restored from backup', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Pay rent', { exact: true }).count(), 0);

  // A structurally corrupt primary document falls back to the last-known-good copy.
  await page.evaluate(() => {
    const valid = localStorage.getItem('taskfocus.data.v1');
    localStorage.setItem('taskfocus.data.v1.bak', valid);
    localStorage.setItem('taskfocus.data.v1', JSON.stringify({ tasks: 'corrupt' }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-route="tasks"]').tap();
  await page.waitForFunction(() => location.hash === '#tasks');
  await page.getByText('Restored from backup', { exact: true }).first().waitFor();

  assert.deepEqual(failures, [], failures.join('\n'));
  await context.close();
  await runNativeNotificationSmoke(browser, origin);
} finally {
  await browser?.close();
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
