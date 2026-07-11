import { parseClock, validEpoch } from './time.js';

export const DATA_VERSION = 1;
export const STORAGE_KEY = 'taskfocus.data.v1';
export const BACKUP_KEY = `${STORAGE_KEY}.bak`;

export const DEFAULT_SETTINGS = Object.freeze({
  quietStart: '22:00',
  quietEnd: '08:00',
  focusLimit: 5,
  theme: 'ember',
});

const TASK_DEFAULTS = Object.freeze({
  title: '',
  notes: '',
  due: null,
  allDay: false,
  priority: 1,
  tags: Object.freeze([]),
  color: null,
  reminder: null,
  timer: null,
  breaks: null,
  muteDuringSession: true,
  session: null,
  parentId: null,
  collapsed: false,
  archived: false,
  completedAt: null,
});

const CATEGORY_COLORS = new Set([
  '#c4576a', '#d96c47', '#d9a441', '#7fa65a',
  '#4a9e8f', '#5b84a8', '#8a6fb8', '#8b97a3',
]);

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function normalizeOptionalEpoch(value) {
  return validEpoch(value) ? Math.trunc(value) : null;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().replace(/^#+/, '').toLowerCase())
    .filter(Boolean))];
}

function normalizeReminder(value) {
  if (!value || typeof value !== 'object' || !finitePositive(value.intervalMin)) return null;
  return {
    intervalMin: Math.max(1, Math.round(value.intervalMin)),
    startAt: normalizeOptionalEpoch(value.startAt),
  };
}

function normalizeTimer(value) {
  if (!value || typeof value !== 'object' || !finitePositive(value.durationMin)) return null;
  return { durationMin: Math.max(1, Math.round(value.durationMin)) };
}

function normalizeBreaks(value) {
  if (!value || typeof value !== 'object'
    || !finitePositive(value.workMin) || !finitePositive(value.breakMin)) return null;
  return {
    workMin: Math.max(1, Math.round(value.workMin)),
    breakMin: Math.max(1, Math.round(value.breakMin)),
  };
}

function normalizeSession(value) {
  if (!value || typeof value !== 'object' || !validEpoch(value.startedAt)) return null;
  return { startedAt: Math.trunc(value.startedAt) };
}

export function createTask(fields = {}, now = Date.now()) {
  const id = Number.isInteger(fields.id) && fields.id > 0 ? fields.id : 0;
  const createdAt = validEpoch(fields.createdAt) ? Math.trunc(fields.createdAt) : Math.trunc(now);
  const rawColor = typeof fields.color === 'string' ? fields.color.toLowerCase() : null;

  return {
    ...TASK_DEFAULTS,
    id,
    title: typeof fields.title === 'string' ? fields.title.trim() : '',
    notes: typeof fields.notes === 'string' ? fields.notes : '',
    due: normalizeOptionalEpoch(fields.due),
    allDay: Boolean(fields.allDay),
    priority: [0, 1, 2].includes(fields.priority) ? fields.priority : 1,
    tags: normalizeTags(fields.tags),
    color: CATEGORY_COLORS.has(rawColor) ? rawColor : null,
    reminder: normalizeReminder(fields.reminder),
    timer: normalizeTimer(fields.timer),
    breaks: normalizeBreaks(fields.breaks),
    muteDuringSession: fields.muteDuringSession !== false,
    session: normalizeSession(fields.session),
    parentId: Number.isInteger(fields.parentId) && fields.parentId > 0 ? fields.parentId : null,
    collapsed: Boolean(fields.collapsed),
    archived: Boolean(fields.archived),
    createdAt,
    completedAt: normalizeOptionalEpoch(fields.completedAt),
  };
}

export function createEmptyData(now = Date.now()) {
  return {
    version: DATA_VERSION,
    meta: { nextTaskId: 1, createdAt: Math.trunc(now), updatedAt: Math.trunc(now) },
    tasks: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function normalizeSettings(value) {
  const settings = value && typeof value === 'object' ? value : {};
  return {
    quietStart: parseClock(settings.quietStart) !== null ? settings.quietStart : DEFAULT_SETTINGS.quietStart,
    quietEnd: parseClock(settings.quietEnd) !== null ? settings.quietEnd : DEFAULT_SETTINGS.quietEnd,
    focusLimit: [3, 5, 7].includes(settings.focusLimit) ? settings.focusLimit : DEFAULT_SETTINGS.focusLimit,
    theme: typeof settings.theme === 'string' && settings.theme ? settings.theme : DEFAULT_SETTINGS.theme,
  };
}

/** Backfills newly-added fields and repairs non-fatal legacy inconsistencies. */
export function migrateData(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createEmptyData(now);
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];
  const tasks = [];
  const seen = new Set();
  let generatedId = 1;

  for (const rawTask of rawTasks) {
    if (!rawTask || typeof rawTask !== 'object') continue;
    let id = Number.isInteger(rawTask.id) && rawTask.id > 0 ? rawTask.id : 0;
    while (!id || seen.has(id)) {
      while (seen.has(generatedId)) generatedId += 1;
      id = generatedId++;
    }
    seen.add(id);
    tasks.push(createTask({ ...rawTask, id }, now));
  }

  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    if (task.parentId === task.id || !ids.has(task.parentId)) task.parentId = null;
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const seenParents = new Set([task.id]);
    let parentId = task.parentId;
    while (parentId != null) {
      if (seenParents.has(parentId)) {
        task.parentId = null;
        break;
      }
      seenParents.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0);
  const rawMeta = value.meta && typeof value.meta === 'object' ? value.meta : {};
  const createdAt = validEpoch(rawMeta.createdAt) ? Math.trunc(rawMeta.createdAt) : Math.trunc(now);
  const updatedAt = validEpoch(rawMeta.updatedAt) ? Math.trunc(rawMeta.updatedAt) : Math.trunc(now);
  const requestedNext = Number.isInteger(rawMeta.nextTaskId) ? rawMeta.nextTaskId : 1;

  return {
    version: DATA_VERSION,
    meta: { nextTaskId: Math.max(1, maxId + 1, requestedNext), createdAt, updatedAt },
    tasks,
    settings: normalizeSettings(value.settings),
  };
}

export function validateDataDocument(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['Backup must contain a JSON object.'] };
  }
  if (!Array.isArray(value.tasks)) errors.push('tasks must be an array.');
  if (value.settings != null && (typeof value.settings !== 'object' || Array.isArray(value.settings))) {
    errors.push('settings must be an object.');
  }

  if (Array.isArray(value.tasks)) {
    const ids = new Set();
    value.tasks.forEach((task, index) => {
      if (!task || typeof task !== 'object' || Array.isArray(task)) {
        errors.push(`tasks[${index}] must be an object.`);
        return;
      }
      if (!Number.isInteger(task.id) || task.id < 1) errors.push(`tasks[${index}].id must be a positive integer.`);
      else if (ids.has(task.id)) errors.push(`Duplicate task id ${task.id}.`);
      else ids.add(task.id);
      if (typeof task.title !== 'string') errors.push(`tasks[${index}].title must be a string.`);
      if (task.due != null && !validEpoch(task.due)) errors.push(`tasks[${index}].due is invalid.`);
      if (task.completedAt != null && !validEpoch(task.completedAt)) errors.push(`tasks[${index}].completedAt is invalid.`);
      if (task.parentId != null && (!Number.isInteger(task.parentId) || task.parentId < 1)) {
        errors.push(`tasks[${index}].parentId is invalid.`);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function prepareImportedData(jsonOrValue, now = Date.now()) {
  let value = jsonOrValue;
  if (typeof jsonOrValue === 'string') {
    try {
      value = JSON.parse(jsonOrValue);
    } catch {
      throw new TypeError('Backup is not valid JSON.');
    }
  }
  const validation = validateDataDocument(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(' '));
  return migrateData(value, now);
}

export function serializeData(data) {
  return JSON.stringify(migrateData(data), null, 2);
}

export function allocateTaskId(data) {
  const maxId = data.tasks.reduce((max, task) => Math.max(max, task.id || 0), 0);
  return Math.max(maxId + 1, data.meta?.nextTaskId || 1);
}

export function withAddedTask(data, fields, now = Date.now()) {
  const id = allocateTaskId(data);
  const task = createTask({ ...fields, id, createdAt: fields.createdAt ?? now }, now);
  return {
    ...data,
    version: DATA_VERSION,
    meta: { ...data.meta, nextTaskId: id + 1, updatedAt: Math.trunc(now) },
    tasks: [...data.tasks, task],
  };
}
