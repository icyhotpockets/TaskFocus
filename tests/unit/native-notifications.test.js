import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_TYPE_DUE,
  ACTION_TYPE_NAG,
  NOTIFICATION_CHANNEL_ID,
  buildNativeSchedule,
  nativeNotificationFromRow,
  taskIdFromNotificationAction,
} from '../../www/js/notifications.js';

const NOW = new Date(2026, 6, 11, 12, 0, 0, 0).getTime();

test('native notification rows keep stable ids, exact times, actions, and task metadata', () => {
  const notification = nativeNotificationFromRow({
    nid: 4200,
    taskId: 42,
    slot: 0,
    kind: 'nag',
    fireAt: NOW + 60_000,
    title: 'Call Mom',
    body: 'Reminder · every 30 min',
  });
  assert.equal(notification.id, 4200);
  assert.equal(notification.channelId, NOTIFICATION_CHANNEL_ID);
  assert.equal(notification.actionTypeId, ACTION_TYPE_NAG);
  assert.equal(notification.schedule.at.getTime(), NOW + 60_000);
  assert.equal(notification.schedule.allowWhileIdle, true);
  assert.deepEqual(notification.extra, { taskId: 42, kind: 'nag', slot: 0 });
});

test('due rows get Done only while session rows have no action type', () => {
  const due = nativeNotificationFromRow({
    nid: 770,
    taskId: 7,
    slot: 70,
    kind: 'due',
    fireAt: NOW + 60_000,
    title: 'Due task',
    body: 'Due now',
  });
  const session = nativeNotificationFromRow({
    nid: 780,
    taskId: 7,
    slot: 80,
    kind: 'session-break',
    fireAt: NOW + 120_000,
    title: 'Focus task',
    body: 'Break time',
  });
  assert.equal(due.actionTypeId, ACTION_TYPE_DUE);
  assert.equal(session.actionTypeId, undefined);
});

test('native schedule consumes the same pure notification truth', () => {
  const data = {
    settings: { quietStart: '22:00', quietEnd: '08:00' },
    tasks: [{
      id: 3,
      title: 'Timed task',
      createdAt: NOW,
      completedAt: null,
      archived: false,
      reminder: { intervalMin: 30, startAt: NOW + 30 * 60_000 },
      due: NOW + 60 * 60_000,
      allDay: false,
      timer: null,
      breaks: null,
      session: null,
      muteDuringSession: true,
    }],
  };
  const rows = buildNativeSchedule(data, NOW);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].id, 300);
  assert.ok(rows.some(({ id }) => id === 370));
  assert.ok(rows.every(({ channelId }) => channelId === NOTIFICATION_CHANNEL_ID));
});

test('notification actions resolve task ids from extra data or stable ids', () => {
  assert.equal(taskIdFromNotificationAction({ notification: { id: 999, extra: { taskId: 12 } } }), 12);
  assert.equal(taskIdFromNotificationAction({ notification: { id: 4270 } }), 42);
  assert.equal(taskIdFromNotificationAction({ notification: { id: 999001 } }), null);
  assert.equal(taskIdFromNotificationAction({ notification: {} }), null);
});
