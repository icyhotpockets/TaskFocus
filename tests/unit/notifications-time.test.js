import test from 'node:test';
import assert from 'node:assert/strict';

import { createTask } from '../../www/js/core/data.js';
import {
  TEST_NOTIFICATION_ID,
  dueAlertTime,
  expireFinishedSessions,
  nextIntervalFire,
  notificationId,
  planDueAlerts,
  planIntervalNags,
  planNotifications,
  planSessionEvents,
  sessionState,
  sessionTimeline,
} from '../../www/js/core/notifications.js';
import {
  HOUR_MS,
  MINUTE_MS,
  addLocalDays,
  formatClock,
  isInQuietHours,
  localDayDifference,
  parseClock,
  sameLocalDay,
} from '../../www/js/core/time.js';

const NOW = new Date(2026, 6, 11, 12, 0, 0, 0).getTime();

function task(id, fields = {}) {
  return createTask({ id, title: `Task ${id}`, createdAt: NOW, ...fields }, NOW);
}

test('clock parsing validates real 24-hour times', () => {
  assert.equal(parseClock('00:00'), 0);
  assert.equal(parseClock('9:05'), 545);
  assert.equal(parseClock('23:59'), 1439);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('12:60'), null);
  assert.equal(parseClock('noon'), null);
});

test('clock formatting wraps into one day', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(1505), '01:05');
  assert.equal(formatClock(-1), '23:59');
});

test('quiet hours work for a same-day range', () => {
  const at = (hour, minute = 0) => new Date(2026, 6, 11, hour, minute).getTime();
  assert.equal(isInQuietHours(at(12), '09:00', '17:00'), true);
  assert.equal(isInQuietHours(at(9), '09:00', '17:00'), true);
  assert.equal(isInQuietHours(at(17), '09:00', '17:00'), false);
  assert.equal(isInQuietHours(at(8, 59), '09:00', '17:00'), false);
});

test('quiet hours cross midnight correctly', () => {
  const at = (hour) => new Date(2026, 6, 11, hour).getTime();
  assert.equal(isInQuietHours(at(23), '22:00', '08:00'), true);
  assert.equal(isInQuietHours(at(4), '22:00', '08:00'), true);
  assert.equal(isInQuietHours(at(8), '22:00', '08:00'), false);
  assert.equal(isInQuietHours(at(12), '22:00', '08:00'), false);
});

test('equal or invalid quiet boundaries disable quiet filtering', () => {
  assert.equal(isInQuietHours(NOW, '22:00', '22:00'), false);
  assert.equal(isInQuietHours(NOW, '99:00', '08:00'), false);
});

test('local calendar-day math is not raw 24-hour division', () => {
  const late = new Date(2026, 2, 7, 23, 59).getTime();
  const early = new Date(2026, 2, 8, 0, 1).getTime();
  assert.equal(localDayDifference(early, late), 1);
  assert.equal(sameLocalDay(early, late), false);
  assert.equal(localDayDifference(addLocalDays(late, 5), late), 5);
});

test('next interval is strictly after a past/current anchor', () => {
  assert.equal(nextIntervalFire(NOW, 30, NOW), NOW + 30 * MINUTE_MS);
  assert.equal(nextIntervalFire(NOW, 30, NOW + 5 * MINUTE_MS), NOW + 30 * MINUTE_MS);
  assert.equal(nextIntervalFire(NOW, 30, NOW + 30 * MINUTE_MS), NOW + 60 * MINUTE_MS);
});

test('future reminder startAt is the first fire time', () => {
  const startAt = NOW + HOUR_MS;
  assert.equal(nextIntervalFire(startAt, 30, NOW), startAt);
});

test('notification ids honor the fixed slot scheme', () => {
  assert.equal(notificationId(42, 0), 4200);
  assert.equal(notificationId(42, 23), 4223);
  assert.equal(notificationId(42, 70), 4270);
  assert.equal(notificationId(42, 99), 4299);
  assert.equal(TEST_NOTIFICATION_ID, 999001);
  assert.throws(() => notificationId(1, 100), /slot/);
});

test('interval planner anchors to createdAt and caps at 24 per task', () => {
  const rows = planIntervalNags([
    task(1, { reminder: { intervalMin: 15, startAt: null } }),
  ], { quietStart: '22:00', quietEnd: '08:00' }, NOW);
  assert.equal(rows.length, 24);
  assert.equal(rows[0].fireAt, NOW + 15 * MINUTE_MS);
  assert.deepEqual(rows.map(({ slot }) => slot), Array.from({ length: 24 }, (_, index) => index));
  assert.ok(rows.every(({ actions }) => actions.includes('done') && actions.includes('snooze')));
});

test('interval planner caps the combined window at 180 earliest rows', () => {
  const tasks = Array.from({ length: 10 }, (_, index) => task(index + 1, {
    reminder: { intervalMin: 15, startAt: null },
  }));
  const rows = planIntervalNags(tasks, {}, NOW);
  assert.equal(rows.length, 180);
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].fireAt <= row.fireAt));
});

test('interval nags are quiet-hour filtered while keeping interval anchors', () => {
  const at21 = new Date(2026, 6, 11, 21, 0).getTime();
  const rows = planIntervalNags([
    task(1, { createdAt: at21, reminder: { intervalMin: 60, startAt: null } }),
  ], { quietStart: '22:00', quietEnd: '08:00' }, at21, { windowHours: 12 });
  assert.equal(new Date(rows[0].fireAt).getHours(), 8);
  assert.ok(rows.every(({ fireAt }) => !isInQuietHours(fireAt, '22:00', '08:00')));
});

test('completed, archived, and switched-off tasks have no interval rows', () => {
  const tasks = [
    task(1, { completedAt: NOW, reminder: { intervalMin: 30, startAt: null } }),
    task(2, { archived: true, reminder: { intervalMin: 30, startAt: null } }),
    task(3),
  ];
  assert.deepEqual(planIntervalNags(tasks, {}, NOW), []);
});

test('a muted running session suppresses only nags inside the session', () => {
  const item = task(1, {
    reminder: { intervalMin: 10, startAt: null },
    timer: { durationMin: 30 },
    session: { startedAt: NOW },
    muteDuringSession: true,
  });
  const rows = planIntervalNags([item], {}, NOW, { windowHours: 1 });
  assert.equal(rows[0].fireAt, NOW + 40 * MINUTE_MS);
});

test('session muting can be disabled per task', () => {
  const item = task(1, {
    reminder: { intervalMin: 10, startAt: null },
    timer: { durationMin: 30 },
    session: { startedAt: NOW },
    muteDuringSession: false,
  });
  const rows = planIntervalNags([item], {}, NOW, { windowHours: 1 });
  assert.equal(rows[0].fireAt, NOW + 10 * MINUTE_MS);
});

test('all-day due alerts fire at 09:00 on the due local date', () => {
  const due = new Date(2026, 6, 12, 23, 59, 59, 999).getTime();
  const item = task(1, { due, allDay: true });
  const fireAt = dueAlertTime(item);
  assert.equal(new Date(fireAt).getHours(), 9);
  assert.equal(new Date(fireAt).getDate(), 12);
  assert.equal(planDueAlerts([item], NOW)[0].body, 'Due today');
});

test('exact due alerts ignore quiet hours and use slot 70', () => {
  const due = new Date(2026, 6, 11, 23, 0).getTime();
  const rows = planDueAlerts([task(7, { due })], NOW);
  assert.equal(rows[0].fireAt, due);
  assert.equal(rows[0].nid, 770);
  assert.equal(rows[0].body, 'Due now');
});

test('past and completed due alerts are skipped', () => {
  assert.deepEqual(planDueAlerts([
    task(1, { due: NOW - 1 }),
    task(2, { due: NOW + HOUR_MS, completedAt: NOW }),
  ], NOW), []);
});

test('timer with work/break cycle interleaves breaks into computed end', () => {
  const item = task(1, {
    timer: { durationMin: 50 },
    breaks: { workMin: 25, breakMin: 5 },
    session: { startedAt: NOW },
  });
  const timeline = sessionTimeline(item);
  assert.equal(timeline.endAt, NOW + 55 * MINUTE_MS);
  assert.deepEqual(timeline.events.map(({ kind, fireAt }) => [kind, (fireAt - NOW) / MINUTE_MS]), [
    ['break', 25], ['work', 30], ['end', 55],
  ]);
});

test('plain timer has one work phase and one end event', () => {
  const timeline = sessionTimeline(task(1, { timer: { durationMin: 30 }, session: { startedAt: NOW } }));
  assert.equal(timeline.phases.length, 1);
  assert.deepEqual(timeline.events.map(({ kind }) => kind), ['end']);
  assert.equal(timeline.endAt, NOW + 30 * MINUTE_MS);
});

test('breaks-only session is a finite single work block', () => {
  const timeline = sessionTimeline(task(1, { breaks: { workMin: 25, breakMin: 5 }, session: { startedAt: NOW } }));
  assert.equal(timeline.endAt, NOW + 25 * MINUTE_MS);
  assert.deepEqual(timeline.events.map(({ kind }) => kind), ['end']);
});

test('session state reports phase and remaining time', () => {
  const item = task(1, {
    timer: { durationMin: 50 }, breaks: { workMin: 25, breakMin: 5 }, session: { startedAt: NOW },
  });
  const duringBreak = sessionState(item, NOW + 27 * MINUTE_MS);
  assert.equal(duringBreak.active, true);
  assert.equal(duringBreak.phase, 'break');
  assert.equal(duringBreak.remainingMs, 28 * MINUTE_MS);
});

test('session event planner assigns 80-series slots and 99 to final', () => {
  const item = task(3, {
    timer: { durationMin: 50 }, breaks: { workMin: 25, breakMin: 5 }, session: { startedAt: NOW },
  });
  const rows = planSessionEvents([item], NOW);
  assert.deepEqual(rows.map(({ slot }) => slot), [80, 81, 99]);
  assert.deepEqual(rows.map(({ body }) => body), ['Break time', 'Back to work', "Time's up"]);
});

test('expired sessions are self-terminated during reconcile', () => {
  const finished = task(1, { timer: { durationMin: 5 }, session: { startedAt: NOW - 10 * MINUTE_MS } });
  const active = task(2, { timer: { durationMin: 20 }, session: { startedAt: NOW - 10 * MINUTE_MS } });
  const result = expireFinishedSessions([finished, active], NOW);
  assert.deepEqual(result.expiredIds, [1]);
  assert.equal(result.tasks[0].session, null);
  assert.notEqual(result.tasks[1].session, null);
});

test('combined planner returns chronological nag, due, and session truth', () => {
  const item = task(1, {
    due: NOW + 20 * MINUTE_MS,
    reminder: { intervalMin: 10, startAt: null },
    timer: { durationMin: 30 },
    session: { startedAt: NOW },
    muteDuringSession: false,
  });
  const rows = planNotifications([item], {}, NOW, { windowHours: 1 });
  assert.ok(rows.some(({ kind }) => kind === 'nag'));
  assert.ok(rows.some(({ kind }) => kind === 'due'));
  assert.ok(rows.some(({ kind }) => kind === 'session-end'));
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].fireAt <= row.fireAt));
  assert.equal(new Set(rows.map(({ nid }) => nid)).size, rows.length);
});
