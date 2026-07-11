import { HOUR_MS, localDayDifference, sameLocalDay } from './time.js';

export function isOverdue(task, now = Date.now()) {
  return task.completedAt == null && task.due != null && task.due < now;
}

export function focusScore(task, now = Date.now()) {
  if (task.completedAt != null || task.archived) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (task.due != null) {
    if (task.due < now) {
      score += 100 + Math.min(48, Math.max(0, (now - task.due) / HOUR_MS));
    } else if (sameLocalDay(task.due, now)) {
      score += 80;
    } else {
      const days = localDayDifference(task.due, now);
      if (days === 1) score += 55;
      else if (days <= 3) score += 35;
      else if (days <= 7) score += 15;
    }
  }

  score += ([0, 1, 2].includes(task.priority) ? task.priority : 1) * 15;
  const ageDays = Math.max(0, localDayDifference(now, task.createdAt ?? now));
  score += Math.min(21, ageDays) * 1.5;
  if (task.reminder) score += 10;
  return score;
}

function compareRanked(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aDue = a.task.due ?? Number.POSITIVE_INFINITY;
  const bDue = b.task.due ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  if (a.task.createdAt !== b.task.createdAt) return a.task.createdAt - b.task.createdAt;
  return a.task.id - b.task.id;
}

export function rankFocusTasks(tasks, now = Date.now()) {
  return tasks
    .filter((task) => task.completedAt == null && !task.archived)
    .map((task) => ({ task, score: focusScore(task, now) }))
    .sort(compareRanked);
}

/** Includes every overdue/today item even when that exceeds the configured limit. */
export function pickFocusTasks(tasks, focusLimit = 5, now = Date.now()) {
  const ranked = rankFocusTasks(tasks, now);
  const mandatory = ranked.filter(({ task }) => task.due != null
    && (task.due < now || sameLocalDay(task.due, now)));
  const selected = [...mandatory];
  const selectedIds = new Set(mandatory.map(({ task }) => task.id));
  const target = Math.max([3, 5, 7].includes(focusLimit) ? focusLimit : 5, mandatory.length);
  for (const candidate of ranked) {
    if (selected.length >= target) break;
    if (!selectedIds.has(candidate.task.id)) {
      selected.push(candidate);
      selectedIds.add(candidate.task.id);
    }
  }
  return selected.sort(compareRanked).map(({ task }) => task);
}

export function taskDateGroup(task, now = Date.now()) {
  if (task.due == null) return 'someday';
  if (task.due < now) return 'overdue';
  if (sameLocalDay(task.due, now)) return 'today';
  return 'upcoming';
}

export function groupTasksByDate(tasks, now = Date.now()) {
  const groups = { overdue: [], today: [], upcoming: [], someday: [] };
  for (const task of tasks) groups[taskDateGroup(task, now)].push(task);
  return groups;
}
