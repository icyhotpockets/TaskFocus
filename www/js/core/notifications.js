import { HOUR_MS, MINUTE_MS, atLocalTime, isInQuietHours, validEpoch } from './time.js';

export const TEST_NOTIFICATION_ID = 999001;

export function notificationId(taskId, slot) {
  if (!Number.isInteger(taskId) || taskId < 1) throw new TypeError('taskId must be a positive integer.');
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) throw new TypeError('slot must be between 0 and 99.');
  return taskId * 100 + slot;
}

export function nextIntervalFire(anchor, intervalMin, now = Date.now()) {
  if (!validEpoch(anchor) || !Number.isFinite(intervalMin) || intervalMin <= 0) return null;
  const intervalMs = Math.max(1, Math.round(intervalMin)) * MINUTE_MS;
  if (anchor > now) return anchor;
  return anchor + (Math.floor((now - anchor) / intervalMs) + 1) * intervalMs;
}

function isOpen(task) {
  return task.completedAt == null && !task.archived;
}

/**
 * Computes the finite work/break timeline. A breaks-only task is one work block;
 * with a timer, timer.durationMin is total work and breaks are interleaved.
 */
export function sessionTimeline(task) {
  if (!task.session || !validEpoch(task.session.startedAt)) return null;
  const timerMin = Number.isFinite(task.timer?.durationMin) && task.timer.durationMin > 0
    ? Math.round(task.timer.durationMin)
    : null;
  const workMin = Number.isFinite(task.breaks?.workMin) && task.breaks.workMin > 0
    ? Math.round(task.breaks.workMin)
    : null;
  const breakMin = Number.isFinite(task.breaks?.breakMin) && task.breaks.breakMin > 0
    ? Math.round(task.breaks.breakMin)
    : null;
  const totalWorkMin = timerMin ?? workMin;
  if (!totalWorkMin) return null;

  const startedAt = task.session.startedAt;
  const phases = [];
  const events = [];
  let cursor = startedAt;
  let remainingWork = totalWorkMin;

  while (remainingWork > 0) {
    const durationMin = workMin ? Math.min(workMin, remainingWork) : remainingWork;
    const endAt = cursor + durationMin * MINUTE_MS;
    phases.push({ kind: 'work', startAt: cursor, endAt });
    remainingWork -= durationMin;
    cursor = endAt;

    if (remainingWork > 0 && breakMin) {
      events.push({ kind: 'break', fireAt: cursor, label: 'Break time' });
      const breakEnd = cursor + breakMin * MINUTE_MS;
      phases.push({ kind: 'break', startAt: cursor, endAt: breakEnd });
      cursor = breakEnd;
      events.push({ kind: 'work', fireAt: cursor, label: 'Back to work' });
    }
  }

  events.push({ kind: 'end', fireAt: cursor, label: "Time's up" });
  return { startedAt, endAt: cursor, totalWorkMin, phases, events };
}

export function sessionState(task, now = Date.now()) {
  const timeline = sessionTimeline(task);
  if (!timeline) return { active: false, phase: null, remainingMs: 0, timeline: null };
  if (now < timeline.startedAt || now >= timeline.endAt) {
    return { active: false, phase: null, remainingMs: Math.max(0, timeline.endAt - now), timeline };
  }
  const phase = timeline.phases.find((candidate) => now >= candidate.startAt && now < candidate.endAt) ?? null;
  return { active: true, phase: phase?.kind ?? null, remainingMs: timeline.endAt - now, timeline };
}

export function expireFinishedSessions(tasks, now = Date.now()) {
  const expiredIds = [];
  const nextTasks = tasks.map((task) => {
    const timeline = sessionTimeline(task);
    if (timeline && timeline.endAt <= now) {
      expiredIds.push(task.id);
      return { ...task, session: null };
    }
    return task;
  });
  return { tasks: nextTasks, expiredIds };
}

export function planIntervalNags(tasks, settings = {}, now = Date.now(), options = {}) {
  const windowMs = (options.windowHours ?? 12) * HOUR_MS;
  const perTaskLimit = Math.min(24, Math.max(0, options.perTaskLimit ?? 24));
  const totalLimit = Math.min(180, Math.max(0, options.totalLimit ?? 180));
  const windowEnd = now + windowMs;
  const rows = [];

  for (const task of tasks) {
    if (!isOpen(task) || !task.reminder || !Number.isFinite(task.reminder.intervalMin)
      || task.reminder.intervalMin <= 0 || perTaskLimit === 0) continue;
    const anchor = validEpoch(task.reminder.startAt) ? task.reminder.startAt : task.createdAt;
    let fireAt = nextIntervalFire(anchor, task.reminder.intervalMin, now);
    if (fireAt == null) continue;
    const intervalMs = Math.max(1, Math.round(task.reminder.intervalMin)) * MINUTE_MS;
    const timeline = task.muteDuringSession ? sessionTimeline(task) : null;
    let slot = 0;
    let safety = 0;
    const maxIterations = Math.ceil(windowMs / intervalMs) + perTaskLimit + 2;

    while (fireAt <= windowEnd && slot < perTaskLimit && safety++ < maxIterations) {
      const mutedBySession = timeline && fireAt >= timeline.startedAt && fireAt <= timeline.endAt;
      if (!mutedBySession && !isInQuietHours(fireAt, settings.quietStart, settings.quietEnd)) {
        rows.push({
          nid: notificationId(task.id, slot),
          taskId: task.id,
          slot,
          kind: 'nag',
          fireAt,
          title: task.title,
          body: `Reminder · every ${Math.round(task.reminder.intervalMin)} min`,
          actions: ['done', 'snooze'],
        });
        slot += 1;
      }
      fireAt += intervalMs;
    }
  }

  return rows.sort((a, b) => a.fireAt - b.fireAt || a.nid - b.nid).slice(0, totalLimit);
}

export function dueAlertTime(task) {
  if (!validEpoch(task.due)) return null;
  return task.allDay ? atLocalTime(task.due, 9, 0, 0, 0) : task.due;
}

export function planDueAlerts(tasks, now = Date.now()) {
  return tasks.flatMap((task) => {
    if (!isOpen(task)) return [];
    const fireAt = dueAlertTime(task);
    if (fireAt == null || fireAt <= now) return [];
    return [{
      nid: notificationId(task.id, 70),
      taskId: task.id,
      slot: 70,
      kind: 'due',
      fireAt,
      title: task.title,
      body: task.allDay ? 'Due today' : 'Due now',
      actions: ['done'],
    }];
  }).sort((a, b) => a.fireAt - b.fireAt || a.nid - b.nid);
}

export function planSessionEvents(tasks, now = Date.now()) {
  const rows = [];
  for (const task of tasks) {
    if (!isOpen(task)) continue;
    const timeline = sessionTimeline(task);
    if (!timeline || timeline.endAt <= now) continue;
    const pending = timeline.events.filter((event) => event.fireAt > now);
    const retained = pending.length <= 20
      ? pending
      : [...pending.slice(0, 19), pending[pending.length - 1]];
    retained.forEach((event, index) => {
      const slot = index === retained.length - 1 && event.kind === 'end' ? 99 : 80 + index;
      rows.push({
        nid: notificationId(task.id, slot),
        taskId: task.id,
        slot,
        kind: `session-${event.kind}`,
        fireAt: event.fireAt,
        title: task.title,
        body: event.label,
        actions: [],
      });
    });
  }
  return rows.sort((a, b) => a.fireAt - b.fireAt || a.nid - b.nid);
}

export function planNotifications(tasks, settings = {}, now = Date.now(), options = {}) {
  return [
    ...planIntervalNags(tasks, settings, now, options),
    ...planDueAlerts(tasks, now),
    ...planSessionEvents(tasks, now),
  ].sort((a, b) => a.fireAt - b.fireAt || a.nid - b.nid);
}
