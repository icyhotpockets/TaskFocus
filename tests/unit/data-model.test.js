import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_KEY,
  DATA_VERSION,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  allocateTaskId,
  createEmptyData,
  createTask,
  migrateData,
  prepareImportedData,
  serializeData,
  validateDataDocument,
  withAddedTask,
} from '../../www/js/core/data.js';
import {
  ancestorsOf,
  childrenOf,
  clearArchivedTasks,
  completeWithDescendants,
  deleteTask,
  descendantsOf,
  isTaskVisibleInTree,
  progressOf,
  restoreTaskStates,
  rootsOf,
  setArchived,
  subtreeOf,
} from '../../www/js/core/model.js';

const NOW = new Date(2026, 6, 11, 12, 0).getTime();

function task(id, parentId = null, fields = {}) {
  return createTask({ id, parentId, title: `Task ${id}`, createdAt: NOW, ...fields }, NOW);
}

test('storage keys are versioned and backup is adjacent', () => {
  assert.equal(STORAGE_KEY, 'taskfocus.data.v1');
  assert.equal(BACKUP_KEY, 'taskfocus.data.v1.bak');
});

test('empty data contains current version and exact setting defaults', () => {
  const data = createEmptyData(NOW);
  assert.equal(data.version, DATA_VERSION);
  assert.deepEqual(data.settings, DEFAULT_SETTINGS);
  assert.deepEqual(data.tasks, []);
  assert.equal(data.meta.nextTaskId, 1);
});

test('createTask normalizes every model field', () => {
  const normalized = createTask({
    id: 4,
    title: '  Buy milk  ',
    notes: 'two cartons',
    due: NOW + 1_000,
    allDay: true,
    priority: 2,
    tags: [' Home ', '#HOME', 'Errands'],
    color: '#C4576A',
    reminder: { intervalMin: 29.6, startAt: NOW },
    timer: { durationMin: 45 },
    breaks: { workMin: 25, breakMin: 5 },
    muteDuringSession: false,
    session: { startedAt: NOW },
    parentId: 2,
    collapsed: true,
    archived: true,
    completedAt: NOW,
  }, NOW);
  assert.deepEqual(normalized.tags, ['home', 'errands']);
  assert.equal(normalized.title, 'Buy milk');
  assert.equal(normalized.color, '#c4576a');
  assert.deepEqual(normalized.reminder, { intervalMin: 30, startAt: NOW });
  assert.deepEqual(normalized.timer, { durationMin: 45 });
  assert.deepEqual(normalized.breaks, { workMin: 25, breakMin: 5 });
  assert.equal(normalized.muteDuringSession, false);
  assert.equal(normalized.parentId, 2);
  assert.equal(normalized.completedAt, NOW);
});

test('createTask backfills invalid fields safely', () => {
  const normalized = createTask({ id: -1, title: 4, priority: 9, tags: 'x', color: '#fff' }, NOW);
  assert.equal(normalized.id, 0);
  assert.equal(normalized.title, '');
  assert.equal(normalized.priority, 1);
  assert.deepEqual(normalized.tags, []);
  assert.equal(normalized.color, null);
  assert.equal(normalized.createdAt, NOW);
});

test('migration backfills legacy fields and advances the monotonic id', () => {
  const migrated = migrateData({ tasks: [{ id: 9, title: 'Legacy' }], settings: {} }, NOW);
  assert.equal(migrated.tasks[0].muteDuringSession, true);
  assert.equal(migrated.tasks[0].archived, false);
  assert.equal(migrated.meta.nextTaskId, 10);
  assert.deepEqual(migrated.settings, DEFAULT_SETTINGS);
});

test('migration repairs duplicate, missing, orphaned, and self-parent ids', () => {
  const migrated = migrateData({
    tasks: [
      { id: 1, title: 'One', parentId: 1 },
      { id: 1, title: 'Duplicate' },
      { title: 'Missing', parentId: 99 },
    ],
  }, NOW);
  assert.equal(new Set(migrated.tasks.map(({ id }) => id)).size, 3);
  assert.ok(migrated.tasks.every(({ id }) => Number.isInteger(id) && id > 0));
  assert.equal(migrated.tasks[0].parentId, null);
  assert.equal(migrated.tasks[2].parentId, null);
});

test('migration breaks parent cycles', () => {
  const migrated = migrateData({ tasks: [
    { id: 1, title: 'A', parentId: 2 },
    { id: 2, title: 'B', parentId: 1 },
  ] }, NOW);
  assert.ok(migrated.tasks.some(({ parentId }) => parentId == null));
  assert.equal(descendantsOf(migrated.tasks, 1).length <= 1, true);
});

test('strict import rejects malformed JSON and malformed task documents', () => {
  assert.throws(() => prepareImportedData('{nope', NOW), /valid JSON/);
  assert.throws(() => prepareImportedData({ tasks: 'no' }, NOW), /tasks must be an array/);
  assert.throws(() => prepareImportedData({ tasks: [{ id: 1, title: 7 }] }, NOW), /title must be a string/);
});

test('strict import accepts an older valid document and migrates it', () => {
  const imported = prepareImportedData(JSON.stringify({ tasks: [{ id: 1, title: 'Old' }] }), NOW);
  assert.equal(imported.version, DATA_VERSION);
  assert.deepEqual(imported.settings, DEFAULT_SETTINGS);
});

test('validation reports duplicate ids', () => {
  const result = validateDataDocument({ tasks: [{ id: 2, title: 'A' }, { id: 2, title: 'B' }] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Duplicate task id 2/);
});

test('serializeData emits readable, normalized JSON', () => {
  const serialized = serializeData({ tasks: [{ id: 3, title: 'Saved' }] });
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.version, DATA_VERSION);
  assert.equal(parsed.tasks[0].title, 'Saved');
  assert.match(serialized, /\n  "version"/);
});

test('withAddedTask allocates monotonic ids without mutating the source', () => {
  const source = migrateData({ tasks: [{ id: 7, title: 'Existing' }], meta: { nextTaskId: 20 } }, NOW);
  assert.equal(allocateTaskId(source), 20);
  const result = withAddedTask(source, { title: 'New' }, NOW + 1);
  assert.equal(result.tasks.at(-1).id, 20);
  assert.equal(result.meta.nextTaskId, 21);
  assert.equal(source.tasks.length, 1);
});

test('tree helpers preserve sibling order and traverse depth-first', () => {
  const tasks = [task(1), task(2, 1), task(3, 1), task(4, 2), task(5, 99)];
  assert.deepEqual(childrenOf(tasks, 1).map(({ id }) => id), [2, 3]);
  assert.deepEqual(descendantsOf(tasks, 1).map(({ id }) => id), [2, 4, 3]);
  assert.deepEqual(subtreeOf(tasks, 2).map(({ id }) => id), [2, 4]);
  assert.deepEqual(rootsOf(tasks).map(({ id }) => id), [1, 5]);
  assert.deepEqual(ancestorsOf(tasks, 4).map(({ id }) => id), [1, 2]);
});

test('progress counts descendants and excludes the parent', () => {
  const tasks = [task(1), task(2, 1, { completedAt: NOW }), task(3, 1), task(4, 2, { completedAt: NOW })];
  assert.deepEqual(progressOf(tasks, 1), { done: 2, total: 3 });
  assert.deepEqual(progressOf(tasks, 4), { done: 0, total: 0 });
});

test('archive applies to the entire subtree only', () => {
  const tasks = [task(1), task(2, 1), task(3)];
  const result = setArchived(tasks, 1, true);
  assert.deepEqual(result.map(({ archived }) => archived), [true, true, false]);
  assert.equal(tasks[0].archived, false);
});

test('completion cascades, returns changed ids, and stops sessions', () => {
  const tasks = [task(1, null, { session: { startedAt: NOW } }), task(2, 1), task(3, 1, { completedAt: NOW - 1 })];
  const result = completeWithDescendants(tasks, 1, NOW);
  assert.equal(result.completed, true);
  assert.deepEqual(result.flippedIds, [1, 2]);
  assert.ok(result.tasks.every(({ completedAt }) => completedAt != null));
  assert.equal(result.tasks[0].session, null);
});

test('uncompletion clears archived state and restoreTaskStates gives exact Undo', () => {
  const tasks = [task(1, null, { completedAt: NOW, archived: true }), task(2, 1, { completedAt: NOW - 5, archived: true })];
  const result = completeWithDescendants(tasks, 1, NOW + 1);
  assert.equal(result.completed, false);
  assert.ok(result.tasks.every((item) => item.completedAt == null && !item.archived));
  assert.deepEqual(restoreTaskStates(result.tasks, result.previousStates), tasks);
});

test('deleteTask removes a full subtree and leaves siblings', () => {
  const tasks = [task(1), task(2, 1), task(3, 2), task(4)];
  const result = deleteTask(tasks, 2);
  assert.deepEqual(result.deletedIds, [2, 3]);
  assert.deepEqual(result.tasks.map(({ id }) => id), [1, 4]);
});

test('clearArchivedTasks removes exactly archived rows', () => {
  const tasks = [task(1, null, { archived: true }), task(2, 1, { archived: true }), task(3)];
  const result = clearArchivedTasks(tasks);
  assert.deepEqual(result.deletedIds, [1, 2]);
  assert.deepEqual(result.tasks.map(({ id }) => id), [3]);
});

test('visibility follows every ancestor collapse state', () => {
  const tasks = [task(1, null, { collapsed: true }), task(2, 1), task(3, 2)];
  assert.equal(isTaskVisibleInTree(tasks, 3), false);
  tasks[0].collapsed = false;
  assert.equal(isTaskVisibleInTree(tasks, 3), true);
});
