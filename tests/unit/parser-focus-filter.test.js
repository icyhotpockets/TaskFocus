import test from 'node:test';
import assert from 'node:assert/strict';

import { createTask } from '../../www/js/core/data.js';
import { filterTasks, hasActiveFilters, inUseTags, matchesTaskFilters, searchTags } from '../../www/js/core/filters.js';
import { focusScore, groupTasksByDate, pickFocusTasks, rankFocusTasks, taskDateGroup } from '../../www/js/core/focus.js';
import { parseQuickAdd } from '../../www/js/core/parser.js';
import { HOUR_MS, endOfLocalDay, localDayDifference, sameLocalDay } from '../../www/js/core/time.js';

const NOW = new Date(2026, 6, 11, 18, 0, 0, 0).getTime();

function task(id, fields = {}) {
  return createTask({ id, title: `Task ${id}`, createdAt: NOW, ...fields }, NOW);
}

test('quick add parses the complete natural-language example', () => {
  const result = parseQuickAdd('Pay rent tomorrow 5pm every 30m high priority #Bills', { now: NOW });
  const due = new Date(result.due);
  assert.equal(result.title, 'Pay rent');
  assert.equal(localDayDifference(result.due, NOW), 1);
  assert.equal(due.getHours(), 17);
  assert.equal(due.getMinutes(), 0);
  assert.equal(result.allDay, false);
  assert.deepEqual(result.reminder, { intervalMin: 30, startAt: null });
  assert.equal(result.priority, 2);
  assert.deepEqual(result.tags, ['bills']);
});

test('quick add converts hour intervals to minutes', () => {
  const result = parseQuickAdd('Water plants every 2h', { now: NOW });
  assert.equal(result.title, 'Water plants');
  assert.equal(result.reminder.intervalMin, 120);
});

test('date-only quick add stamps the local date at end of day', () => {
  const result = parseQuickAdd('Submit form tomorrow', { now: NOW });
  assert.equal(result.allDay, true);
  assert.equal(result.due, endOfLocalDay(new Date(2026, 6, 12)));
});

test('a bare past 12-hour time rolls to tomorrow', () => {
  const result = parseQuickAdd('Call Sam 5pm', { now: NOW });
  assert.equal(localDayDifference(result.due, NOW), 1);
  assert.equal(new Date(result.due).getHours(), 17);
});

test('a bare future 24-hour time stays today', () => {
  const result = parseQuickAdd('Take medicine 19:30', { now: NOW });
  assert.equal(sameLocalDay(result.due, NOW), true);
  assert.equal(new Date(result.due).getHours(), 19);
  assert.equal(new Date(result.due).getMinutes(), 30);
});

test('weekday parsing picks the next occurrence', () => {
  const result = parseQuickAdd('Review plan monday', { now: NOW });
  assert.equal(new Date(result.due).getDay(), 1);
  assert.ok(result.due > NOW);
});

test('same-weekday past time advances seven days', () => {
  const friday = new Date(2026, 6, 10, 18, 0).getTime();
  const result = parseQuickAdd('Dinner friday 5pm', { now: friday });
  assert.equal(localDayDifference(result.due, friday), 7);
});

test('month/day parsing uses this year or next year when already past', () => {
  const future = parseQuickAdd('Birthday jul 12', { now: NOW });
  const past = parseQuickAdd('Birthday jul 10', { now: NOW });
  assert.equal(new Date(future.due).getFullYear(), 2026);
  assert.equal(new Date(past.due).getFullYear(), 2027);
});

test('invalid calendar dates stay in the title', () => {
  const result = parseQuickAdd('Something feb 30', { now: NOW });
  assert.equal(result.due, null);
  assert.equal(result.title, 'Something feb 30');
});

test('tags normalize and deduplicate', () => {
  const result = parseQuickAdd('Pack #Trip #trip #Carry_On', { now: NOW });
  assert.deepEqual(result.tags, ['trip', 'carry_on']);
  assert.equal(result.title, 'Pack');
});

test('tag names that resemble parser keywords stay tags only', () => {
  const result = parseQuickAdd('Plan #today #high', { now: NOW });
  assert.equal(result.title, 'Plan');
  assert.equal(result.due, null);
  assert.equal(result.priority, null);
  assert.deepEqual(result.tags, ['today', 'high']);
});

test('cleared parser types no longer overwrite or remove that phrase', () => {
  const result = parseQuickAdd('Buy high priority shoes tomorrow', {
    now: NOW,
    clearedTypes: new Set(['priority']),
  });
  assert.equal(result.priority, null);
  assert.equal(result.title, 'Buy high priority shoes');
  assert.ok(result.due);
});

test('parsed chips expose removable type and source ranges', () => {
  const result = parseQuickAdd('Pay #bills tomorrow', { now: NOW });
  assert.deepEqual(result.parsed.map(({ type }) => type), ['tags', 'date']);
  assert.ok(result.parsed.every(({ start, end }) => Number.isInteger(start) && end > start));
});

test('filter matching is OR within tags', () => {
  const item = task(1, { tags: ['home'] });
  assert.equal(matchesTaskFilters(item, { tags: ['work', 'home'] }), true);
  assert.equal(matchesTaskFilters(item, { tags: ['work', 'urgent'] }), false);
});

test('filter matching is OR within colors and AND across kinds', () => {
  const item = task(1, { tags: ['home'], color: '#c4576a' });
  assert.equal(matchesTaskFilters(item, { colors: ['#c4576a', '#d96c47'], tags: ['home'] }), true);
  assert.equal(matchesTaskFilters(item, { colors: ['#c4576a'], tags: ['work'] }), false);
  assert.equal(matchesTaskFilters(item, { colors: ['#d96c47'], tags: ['home'] }), false);
});

test('empty filters match everything and active state is exact', () => {
  assert.equal(matchesTaskFilters(task(1), {}), true);
  assert.equal(hasActiveFilters({}), false);
  assert.equal(hasActiveFilters({ tags: ['x'] }), true);
});

test('filterTasks returns flat direct matches', () => {
  const tasks = [task(1, { tags: ['a'] }), task(2, { tags: ['b'] }), task(3, { tags: ['a', 'b'] })];
  assert.deepEqual(filterTasks(tasks, { tags: ['b'] }).map(({ id }) => id), [2, 3]);
});

test('tag list is unique, sorted, and live-searchable', () => {
  const tags = inUseTags([task(1, { tags: ['Zoo', 'home'] }), task(2, { tags: ['home', 'work'] })]);
  assert.deepEqual(tags, ['home', 'work', 'zoo']);
  assert.deepEqual(searchTags(tags, 'o'), ['home', 'work', 'zoo']);
  assert.deepEqual(searchTags(tags, 'wo'), ['work']);
});

test('focus score follows overdue hours, priority, and reminder weights', () => {
  const item = task(1, { due: NOW - HOUR_MS, priority: 2, reminder: { intervalMin: 30, startAt: null } });
  assert.equal(focusScore(item, NOW), 100 + 1 + 30 + 10);
});

test('focus due-date bands are exact', () => {
  const day = (count) => new Date(2026, 6, 11 + count, 20, 0).getTime();
  assert.equal(focusScore(task(1, { due: day(0), priority: 0 }), NOW), 80);
  assert.equal(focusScore(task(2, { due: day(1), priority: 0 }), NOW), 55);
  assert.equal(focusScore(task(3, { due: day(3), priority: 0 }), NOW), 35);
  assert.equal(focusScore(task(4, { due: day(7), priority: 0 }), NOW), 15);
  assert.equal(focusScore(task(5, { due: day(8), priority: 0 }), NOW), 0);
});

test('staleness awards 1.5 per local day and caps at 21 days', () => {
  const tenDays = task(1, { priority: 0, createdAt: new Date(2026, 6, 1, 23).getTime() });
  const ancient = task(2, { priority: 0, createdAt: new Date(2025, 0, 1).getTime() });
  assert.equal(focusScore(tenDays, NOW), 15);
  assert.equal(focusScore(ancient, NOW), 31.5);
});

test('completed and archived tasks are never ranked', () => {
  const tasks = [task(1), task(2, { completedAt: NOW }), task(3, { archived: true })];
  assert.deepEqual(rankFocusTasks(tasks, NOW).map(({ task: item }) => item.id), [1]);
  assert.equal(focusScore(tasks[1], NOW), Number.NEGATIVE_INFINITY);
});

test('every overdue and due-today task is mandatory beyond the focus limit', () => {
  const tasks = Array.from({ length: 5 }, (_, index) => task(index + 1, { due: NOW - index * HOUR_MS, priority: 0 }));
  assert.equal(pickFocusTasks(tasks, 3, NOW).length, 5);
});

test('focus fill uses deterministic score and id tie breakers', () => {
  const tasks = [task(8, { priority: 0 }), task(2, { priority: 2 }), task(4, { priority: 1 }), task(1, { priority: 0 })];
  assert.deepEqual(pickFocusTasks(tasks, 3, NOW).map(({ id }) => id), [2, 4, 1]);
});

test('date groups keep completed tasks based on due date until archived', () => {
  const pastToday = new Date(2026, 6, 11, 17).getTime();
  const tomorrow = new Date(2026, 6, 12, 9).getTime();
  const tasks = [
    task(1, { due: pastToday, completedAt: NOW }),
    task(2, { due: new Date(2026, 6, 11, 20).getTime() }),
    task(3, { due: tomorrow }),
    task(4),
  ];
  assert.equal(taskDateGroup(tasks[0], NOW), 'overdue');
  const groups = groupTasksByDate(tasks, NOW);
  assert.deepEqual(groups.overdue.map(({ id }) => id), [1]);
  assert.deepEqual(groups.today.map(({ id }) => id), [2]);
  assert.deepEqual(groups.upcoming.map(({ id }) => id), [3]);
  assert.deepEqual(groups.someday.map(({ id }) => id), [4]);
});
