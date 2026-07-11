import { isNative, platformName } from "./native.js";
import {
  BACKUP_KEY,
  STORAGE_KEY,
  createEmptyData,
  migrateData,
  prepareImportedData,
  serializeData,
  validateDataDocument,
  withAddedTask,
} from "./core/data.js";
import {
  filterTasks,
  hasActiveFilters,
  inUseColors,
  inUseTags,
  searchTags,
} from "./core/filters.js";
import { pickFocusTasks, groupTasksByDate } from "./core/focus.js";
import {
  completeWithDescendants,
  deleteTask as deleteTaskFromModel,
  restoreTaskStates,
  setArchived,
} from "./core/model.js";
import { expireFinishedSessions, sessionState } from "./core/notifications.js";
import { parseQuickAdd } from "./core/parser.js";
import { CATEGORY_COLORS } from "./core/themes.js";
import { checkForNativeUpdate } from "./update.js";
import {
  applyTheme,
  themeFamilies,
  themePreviewStyle,
  themes,
  themesForFamily,
} from "./themes.js";

const VALID_ROUTES = new Set(["tasks", "calendar", "settings"]);

const view = document.querySelector("#view");
const sheetsRoot = document.querySelector("#sheets");
const toastsRoot = document.querySelector("#toasts");
const fab = document.querySelector("#fab");

let documentState = loadDocument();
let currentRoute = routeFromHash();
let currentSheet = null;
let saveTimer = null;
let selectedThemeFamily = themes[documentState.settings.theme]?.family || "ember";
let calendarCursor = startOfMonth(new Date());
let selectedCalendarDate = dateKey(new Date());
let buildLabel = "development";
let buildVersionName = "development";
let activeFilters = { colors: [], tags: [] };
const routeScroll = new Map();
let touchAction = null;

applyTheme(documentState.settings.theme);
ensureRoute();
bindShellEvents();
rerender({ entry: true });
loadBuildVersion({ reloadOnChange: !isNative });
registerServiceWorker();
checkForUpdates();

setInterval(() => {
  if (!currentSheet && document.visibilityState === "visible") {
    rerender();
  }
}, 30_000);

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadBuildVersion({ reloadOnChange: true });
    reconcileFinishedSessions();
    if (!currentSheet) rerender();
  }
});

function defaultDocument() {
  return createEmptyData();
}

function normalizeDocument(value) {
  return migrateData(value);
}

function loadDocument() {
  for (const key of [STORAGE_KEY, BACKUP_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const loadable = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        && Array.isArray(parsed.tasks)
        && parsed.tasks.every((task) => task && typeof task === "object" && !Array.isArray(task) && typeof task.title === "string");
      if (!loadable) continue;
      const normalized = normalizeDocument(parsed);
      if (validateDataDocument(normalized).valid) return normalized;
    } catch {
      // Try the last-known-good copy, then start clean.
    }
  }
  return defaultDocument();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistDocumentNow(), 250);
}

function persistDocumentNow(nextDocument = documentState, { backupDocument = null } = {}) {
  clearTimeout(saveTimer);
  try {
    const current = backupDocument ? JSON.stringify(backupDocument) : localStorage.getItem(STORAGE_KEY);
    if (current) localStorage.setItem(BACKUP_KEY, current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDocument));
    return true;
  } catch {
    showToast("TaskFocus could not save this change.");
    return false;
  }
}

function routeFromHash() {
  const candidate = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return VALID_ROUTES.has(candidate) ? candidate : "tasks";
}

function ensureRoute() {
  if (!VALID_ROUTES.has(location.hash.slice(1))) {
    history.replaceState(null, "", "#tasks");
  }
}

function bindShellEvents() {
  window.addEventListener("hashchange", () => {
    routeScroll.set(currentRoute, window.scrollY);
    currentRoute = routeFromHash();
    closeSheet();
    rerender({ entry: true, restoreRouteScroll: true });
  });

  fab.addEventListener("click", () => openAddSheet());

  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) handleAction(actionTarget, event);

    const picker = event.target.closest("[data-show-picker]");
    if (picker?.showPicker) {
      try { picker.showPicker(); } catch { /* The native picker still opens normally where supported. */ }
    }
  });

  sheetsRoot.addEventListener("input", (event) => {
    handleSheetInput(event.target, event.type);
  });

  sheetsRoot.addEventListener("change", (event) => handleSheetInput(event.target, event.type));

  sheetsRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
    if (event.key === "Enter" && event.target.id === "quick-task-input") {
      event.preventDefault();
      submitAddTask();
    }
  });

  document.addEventListener("touchstart", (event) => {
    const target = event.target.closest("[data-touch-action], #sheets button[data-action]");
    if (!target || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchAction = { target, x: touch.clientX, y: touch.clientY, startedAt: Date.now() };
  }, { passive: true });

  document.addEventListener("touchend", (event) => {
    if (!touchAction) return;
    const ended = event.changedTouches[0];
    const pending = touchAction;
    touchAction = null;
    event.preventDefault();
    if (!ended || Date.now() - pending.startedAt > 600
      || Math.hypot(ended.clientX - pending.x, ended.clientY - pending.y) > 12) return;
    handleAction(pending.target, event);
  }, { passive: false });

  document.addEventListener("touchcancel", () => { touchAction = null; }, { passive: true });
}

function handleAction(actionTarget, event) {
  const { action } = actionTarget.dataset;
  if (action === "close-sheet" || action === "filter-done") {
    closeSheet();
  } else if (action === "add-task") {
    submitAddTask();
  } else if (action === "toggle-task") {
    event?.stopPropagation();
    toggleTask(Number(actionTarget.dataset.taskId));
  } else if (action === "edit-task") {
    openEditSheet(Number(actionTarget.dataset.taskId));
  } else if (action === "save-edit") {
    saveTaskEdit(Number(actionTarget.dataset.taskId));
  } else if (action === "delete-task") {
    deleteTask(Number(actionTarget.dataset.taskId));
  } else if (action === "confirm-delete-task") {
    deleteTask(Number(actionTarget.dataset.taskId), true);
  } else if (action === "open-category-filter") {
    openFilterSheet("colors");
  } else if (action === "open-tag-filter") {
    openFilterSheet("tags");
  } else if (action === "toggle-filter-color") {
    toggleFilter("colors", actionTarget.dataset.filterColor);
  } else if (action === "toggle-filter-tag") {
    toggleFilter("tags", actionTarget.dataset.filterTag);
  } else if (action === "clear-filters") {
    clearFilters(actionTarget.dataset.filterKind);
  } else if (action === "task-option") {
    toggleTaskOption(actionTarget.dataset.option);
  } else if (action === "remove-parsed") {
    removeParsedType(actionTarget.dataset.type);
  } else if (action === "set-draft-priority") {
    setDraftPriority(Number(actionTarget.dataset.priority));
  } else if (action === "set-draft-color") {
    setDraftColor(actionTarget.dataset.color || null);
  } else if (action === "toggle-session") {
    event?.stopPropagation();
    toggleSession(Number(actionTarget.dataset.taskId));
  } else if (action === "theme-family") {
    selectedThemeFamily = actionTarget.dataset.family;
    rerender();
  } else if (action === "theme") {
    selectTheme(actionTarget.dataset.theme);
  } else if (action === "focus-limit") {
    documentState.settings.focusLimit = Number(actionTarget.dataset.value);
    scheduleSave();
    rerender();
  } else if (action === "calendar-prev") {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    rerender();
  } else if (action === "calendar-next") {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    rerender();
  } else if (action === "calendar-today") {
    calendarCursor = startOfMonth(new Date());
    selectedCalendarDate = dateKey(new Date());
    rerender();
  } else if (action === "calendar-select") {
    selectedCalendarDate = actionTarget.dataset.date;
    const selected = parseDateKey(selectedCalendarDate);
    calendarCursor = startOfMonth(selected);
    rerender();
  } else if (action === "export-backup") {
    exportBackup();
  } else if (action === "import-backup") {
    chooseImportBackup();
  } else if (action === "confirm-import") {
    confirmImport();
  } else if (action === "open-quiet-hours") {
    openQuietHoursSheet();
  } else if (action === "save-quiet-hours") {
    saveQuietHours();
  }
}

function rerender({ entry = false, restoreRouteScroll = false } = {}) {
  reconcileFinishedSessions();
  const scrollTop = restoreRouteScroll ? routeScroll.get(currentRoute) || 0 : window.scrollY;
  const openDetails = new Set(
    [...view.querySelectorAll("details[open][data-detail-key]")].map((node) => node.dataset.detailKey),
  );
  const renderers = {
    tasks: renderTasksView,
    calendar: renderCalendarView,
    settings: renderSettingsView,
  };

  view.innerHTML = renderers[currentRoute]();
  view.querySelector(".page")?.classList.toggle("enter", entry);
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.route === currentRoute;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });

  for (const key of openDetails) {
    const details = view.querySelector(`details[data-detail-key="${CSS.escape(key)}"]`);
    if (details) details.open = true;
  }

  requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: "auto" }));
}

function reconcileFinishedSessions() {
  const reconciled = expireFinishedSessions(documentState.tasks);
  if (!reconciled.expiredIds.length) return false;
  documentState.tasks = reconciled.tasks;
  scheduleSave();
  return true;
}

function renderTasksView() {
  const now = new Date();
  const open = documentState.tasks.filter((task) => !task.archived && !task.completedAt);
  const completedToday = documentState.tasks.filter(
    (task) => task.completedAt && dateKey(new Date(task.completedAt)) === dateKey(now),
  );
  const doneRoots = documentState.tasks
    .filter((task) => task.archived && !task.parentId)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const focus = pickFocusTasks(open, documentState.settings.focusLimit, now.getTime());
  const focusIds = new Set(focus.map((task) => task.id));
  const remaining = open.filter((task) => !focusIds.has(task.id));
  const groups = groupTasksByDate(remaining, now.getTime());
  const filtering = hasActiveFilters(activeFilters);
  const filtered = filtering ? filterTasks(open, activeFilters) : [];
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const dateText = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  return `
    <div class="page tasks-page">
      <header class="page-header">
        <div class="eyebrow">TaskFocus</div>
        <h1 class="page-title">${greeting}</h1>
        <p class="page-subtitle">${escapeHtml(dateText)} · ${open.length} open · ${completedToday.length} done today</p>
      </header>

      <div class="filter-row" aria-label="Task filters">
        <button class="chip ${activeFilters.colors.length ? "active" : ""}" type="button" data-action="open-category-filter">
          <span class="chip-dot" style="--chip-color:var(--accent-bright)"></span>
          Category${activeFilters.colors.length ? ` · ${activeFilters.colors.length}` : ""}
        </button>
        <button class="chip ${activeFilters.tags.length ? "active" : ""}" type="button" data-action="open-tag-filter">
          # Tags${activeFilters.tags.length ? ` · ${activeFilters.tags.length}` : ""}
        </button>
      </div>

      ${filtering ? `
        ${filtered.length
          ? renderTaskSection("Filtered tasks", filtered, "filtered", false, true)
          : renderNoFilterMatches()}
      ` : open.length === 0 ? renderEmptyState() : `
        ${focus.length ? renderTaskSection("Your focus", focus, "focus", true) : ""}
        ${groups.overdue.length ? renderTaskSection("Overdue", groups.overdue, "overdue") : ""}
        ${groups.today.length ? renderTaskSection("Today", groups.today, "today") : ""}
        ${groups.upcoming.length ? renderTaskSection("Upcoming", groups.upcoming, "upcoming") : ""}
        ${groups.someday.length ? renderTaskSection("Someday", groups.someday, "someday") : ""}
      `}

      ${renderDoneSection(doneRoots)}
    </div>
  `;
}

function renderNoFilterMatches() {
  return `
    <section class="empty-state compact" style="--i:0">
      <div>
        <h2>No matches.</h2>
        <p>Try another category or tag.</p>
        <button class="button ghost" type="button" data-action="clear-filters">Clear filters</button>
      </div>
    </section>
  `;
}

function renderEmptyState() {
  return `
    <section class="empty-state" style="--i:0">
      <div>
        <div class="empty-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"></path></svg>
        </div>
        <h2>All clear.</h2>
        <p>Tap + to capture your first task.</p>
        <span class="example-copy">Try “Call Mom tomorrow 5pm #family”</span>
      </div>
    </section>
  `;
}

function renderTaskSection(title, tasks, key, focus = false, parentLabels = false) {
  return `
    <section class="section" aria-labelledby="section-${key}">
      <div class="section-heading-row">
        <h2 id="section-${key}">${escapeHtml(title)}</h2>
        <span class="section-count">${tasks.length}${focus ? ` of ${documentState.settings.focusLimit}` : ""}</span>
      </div>
      <div class="task-list">${tasks.map((task, index) => renderTaskCard(task, index, {
        parentLabel: parentLabels ? parentTitle(task) : "",
      })).join("")}</div>
    </section>
  `;
}

function renderTaskCard(task, index = 0, { parentLabel = "" } = {}) {
  const due = task.due ? dueChip(task) : "";
  const timer = task.session
    ? `<span class="chip progress">⏱ ${sessionTimeLabel(task)}</span>`
    : task.timer?.durationMin
      ? `<span class="chip">⏱ ${task.timer.durationMin}m</span>`
      : "";
  const priority = task.priority === 2 ? `<span class="chip priority-high">high</span>` : "";
  const reminder = task.reminder
    ? `<span class="chip pending">every ${formatMinutes(task.reminder.intervalMin)} · delivery pending</span>`
    : "";
  const category = task.color
    ? `<span class="chip"><span class="chip-dot" style="--chip-color:${safeColor(task.color)}"></span> category</span>`
    : "";
  const tag = task.tags?.length ? `<span class="chip">#${escapeHtml(task.tags[0])}${task.tags.length > 1 ? ` +${task.tags.length - 1}` : ""}</span>` : "";
  const done = Boolean(task.completedAt);

  return `
    <div class="task-card-wrap ${task.parentId ? "tree-child" : ""}" style="--i:${index}">
      <article class="task-card ${done ? "is-done" : ""}" data-action="edit-task" data-task-id="${task.id}" tabindex="0">
        <button class="task-check ${done ? "done" : ""}" type="button" data-action="toggle-task" data-task-id="${task.id}" aria-label="${done ? "Mark open" : "Complete"} ${escapeHtml(task.title)}">
          <svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-9"></path></svg>
        </button>
        <div class="task-content">
          ${parentLabel ? `<p class="parent-label">${escapeHtml(parentLabel)}</p>` : ""}
          <p class="task-title">${escapeHtml(task.title)}</p>
          ${due || timer || reminder || priority || category || tag ? `<div class="task-meta">${category}${due}${timer}${priority}${reminder}${tag}</div>` : ""}
        </div>
        <div class="task-trailing">
          ${!done && (task.timer || task.breaks) ? `
            <button class="icon-button ${task.session ? "session-active" : ""}" type="button" data-action="toggle-session" data-task-id="${task.id}" aria-label="${task.session ? "Stop" : "Start"} focus session">
              <svg viewBox="0 0 24 24">${task.session ? '<rect x="8" y="8" width="8" height="8" rx="1"></rect>' : '<path d="m9 7 8 5-8 5Z"></path>'}</svg>
            </button>
          ` : ""}
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:var(--text-faint);stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="m9 6 6 6-6 6"></path></svg>
        </div>
      </article>
    </div>
  `;
}

function renderDoneSection(doneRoots) {
  if (!doneRoots.length) return "";
  return `
    <section class="section">
      <details class="done-details" data-detail-key="done">
        <summary><span>Done (${doneRoots.length})</span><span aria-hidden="true">⌄</span></summary>
        <div class="done-body">
          <div class="task-list">${doneRoots.slice(0, 30).map((task, index) => renderTaskCard(task, index)).join("")}</div>
        </div>
      </details>
    </section>
  `;
}

function dueChip(task) {
  const now = new Date();
  const due = new Date(task.due);
  const key = dateKey(due);
  const today = dateKey(now);
  const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const clock = task.allDay ? "" : ` · ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(due)}`;

  if (key < today) return `<span class="chip overdue">Overdue${clock}</span>`;
  if (key === today) return `<span class="chip due-today">Today${clock}</span>`;
  if (key === tomorrow) return `<span class="chip">Tomorrow${clock}</span>`;
  return `<span class="chip">${escapeHtml(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(due))}${clock}</span>`;
}

function sessionTimeLabel(task) {
  const state = sessionState(task, Date.now());
  const phase = state.phase === "break" ? "break · " : "";
  return `${phase}${Math.max(0, Math.ceil(state.remainingMs / 60_000))}m left`;
}

function renderCalendarView() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const gridStart = new Date(year, month, 1 - new Date(year, month, 1).getDay());
  const today = dateKey(new Date());
  const openDueKeys = new Set(
    documentState.tasks.filter((task) => task.due && !task.completedAt).map((task) => dateKey(new Date(task.due))),
  );
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = dateKey(day);
    const classes = [
      "calendar-cell",
      day.getMonth() !== month ? "outside" : "",
      key === today ? "today" : "",
      key === selectedCalendarDate ? "selected" : "",
    ].filter(Boolean).join(" ");
    return `
      <button class="${classes}" style="--i:${index}" type="button" data-action="calendar-select" data-date="${key}" aria-label="${escapeHtml(day.toDateString())}">
        ${day.getDate()}${openDueKeys.has(key) ? `<span class="calendar-dot"></span>` : ""}
      </button>
    `;
  }).join("");
  const selectedTasks = documentState.tasks.filter(
    (task) => task.due && dateKey(new Date(task.due)) === selectedCalendarDate && !task.archived,
  );
  const selectedDate = parseDateKey(selectedCalendarDate);

  return `
    <div class="page calendar-page">
      <header class="page-header">
        <div class="eyebrow">Plan ahead</div>
        <h1 class="page-title">Calendar</h1>
        <p class="page-subtitle">See your days without losing your focus.</p>
      </header>

      <section class="calendar-panel">
        <div class="calendar-toolbar">
          <button class="icon-button" type="button" data-action="calendar-prev" aria-label="Previous month">
            <svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"></path></svg>
          </button>
          <h2 class="calendar-month">${escapeHtml(new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(calendarCursor))}</h2>
          <button class="icon-button" type="button" data-action="calendar-next" aria-label="Next month">
            <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"></path></svg>
          </button>
        </div>
        <div class="calendar-weekdays" aria-hidden="true">${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid">${cells}</div>
        <button class="button ghost calendar-today-button" type="button" data-action="calendar-today">Today</button>
      </section>

      <section class="section">
        <div class="section-heading-row">
          <h2>${escapeHtml(new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(selectedDate))}</h2>
          <span class="section-count">${selectedTasks.length}</span>
        </div>
        ${selectedTasks.length
          ? `<div class="task-list">${selectedTasks.map((task, index) => renderTaskCard(task, index)).join("")}</div>`
          : `<div class="settings-card"><span class="muted small">Nothing scheduled. Tap + to add something.</span></div>`}
      </section>
    </div>
  `;
}

function renderSettingsView() {
  const currentTheme = themes[documentState.settings.theme] || themes.ember;
  const family = themeFamilies[selectedThemeFamily];
  const themeButtons = themesForFamily(selectedThemeFamily).map((theme) => `
    <button
      class="theme-option ${theme.id === currentTheme.id ? "selected" : ""}"
      type="button"
      data-action="theme"
      data-theme="${theme.id}"
      style="${themePreviewStyle(theme)}"
    >
      <span class="theme-preview-dot"></span>
      ${escapeHtml(theme.name)}${theme.light ? " ☀︎" : ""}
    </button>
  `).join("");

  return `
    <div class="page settings-page">
      <header class="page-header">
        <div class="eyebrow">Make it yours</div>
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">A calm system that stays out of your way.</p>
      </header>

      <div class="settings-stack">
        <section class="settings-card" style="--i:0">
          <div class="settings-card-header">
            <div><h2>Notifications</h2><p>Reminders that keep working when the app is closed.</p></div>
            <span class="platform-pill">${escapeHtml(platformName())}</span>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>Permission</strong><span>Delivery setup comes in the notification build</span></div>
            <button class="button" type="button" disabled>Next round</button>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>Quiet hours</strong><span>${documentState.settings.quietStart}–${documentState.settings.quietEnd}</span></div>
            <button class="button ghost" type="button" data-action="open-quiet-hours">Edit</button>
          </div>
        </section>

        <section class="settings-card" style="--i:1">
          <div class="settings-card-header">
            <div><h2>Appearance</h2><p>${escapeHtml(currentTheme.name)}</p></div>
          </div>
          <div class="theme-family-row">
            ${Object.entries(themeFamilies).map(([id, item]) => `
              <button class="chip theme-family ${id === selectedThemeFamily ? "active" : ""}" type="button" data-action="theme-family" data-family="${id}">${escapeHtml(item.label)}</button>
            `).join("")}
          </div>
          <p class="theme-blurb">${escapeHtml(family.blurb)}</p>
          <div class="theme-variant-row">${themeButtons}</div>
        </section>

        <section class="settings-card" style="--i:2">
          <div class="settings-card-header">
            <div><h2>Focus</h2><p>How many tasks appear in Your focus.</p></div>
          </div>
          <div class="segmented" role="group" aria-label="Focus list size">
            ${[3, 5, 7].map((limit) => `
              <button class="segmented-option ${limit === documentState.settings.focusLimit ? "selected" : ""}" type="button" data-action="focus-limit" data-value="${limit}">${limit}</button>
            `).join("")}
          </div>
        </section>

        <section class="settings-card" style="--i:3">
          <div class="settings-card-header">
            <div><h2>Backup</h2><p>Your tasks stay on this device.</p></div>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>Export backup</strong><span>Save or share a JSON copy</span></div>
            <button class="button" type="button" data-action="export-backup">Export</button>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>Import backup</strong><span>Replace tasks from a saved copy</span></div>
            <button class="button ghost" type="button" data-action="import-backup">Import</button>
          </div>
        </section>

        <section class="settings-card" style="--i:4">
          <div class="settings-card-header">
            <div><h2>Build status</h2><p>What works now and what comes next.</p></div>
          </div>
          <div class="build-status-list">
            <div class="build-status-row"><span>Task editor, filters, backup, basic focus timer</span><span class="status-pill ready">Ready</span></div>
            <div class="build-status-row"><span>Subtasks, gestures, completion animation</span><span class="status-pill next">Next</span></div>
            <div class="build-status-row"><span>Background reminders and iPhone push</span><span class="status-pill planned">Planned</span></div>
          </div>
        </section>

        <section class="settings-card" style="--i:5">
          <div class="about-mark">
            <div class="about-logo" aria-hidden="true">TF</div>
            <div class="setting-label">
              <strong>TaskFocus</strong>
              <span>${escapeHtml(buildVersionName)} · Build ${escapeHtml(buildLabel)} · ${isNative ? "Android" : "Web"}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function openFilterSheet(kind) {
  currentSheet = { type: "filter", kind, query: "" };
  document.body.classList.add("sheet-open");
  renderFilterSheet({ focusSearch: kind === "tags" });
}

function renderFilterSheet({ focusSearch = false } = {}) {
  if (currentSheet?.type !== "filter") return;
  const previousScroll = sheetsRoot.querySelector(".sheet")?.scrollTop || 0;
  const searchWasFocused = document.activeElement?.matches?.('[data-filter-search="tags"]');
  const { kind } = currentSheet;
  const isTags = kind === "tags";
  const openTasks = documentState.tasks.filter((task) => !task.archived);
  const allColors = [...new Set([...inUseColors(openTasks), ...activeFilters.colors])];
  const allTags = [...new Set([...inUseTags(openTasks), ...activeFilters.tags])].sort((a, b) => a.localeCompare(b));
  const visibleTags = searchTags(allTags, currentSheet.query);
  const choices = isTags
    ? renderTagFilterChoices(visibleTags)
    : renderColorFilterChoices(allColors);

  sheetsRoot.innerHTML = `
    <div class="sheet-layer" role="presentation">
      <button class="sheet-scrim" type="button" data-action="close-sheet" aria-label="Close filters"></button>
      <section class="sheet filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-sheet-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="sheet-header">
          <div>
            <h2 class="sheet-title" id="filter-sheet-title">${isTags ? "Filter by tags" : "Filter by category"}</h2>
            <p class="sheet-subtitle">Choose more than one to match any selected ${isTags ? "tag" : "category"}.</p>
          </div>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close">×</button>
        </header>
        ${isTags ? `
          <label class="field">
            <span class="field-label">Search tags</span>
            <input class="input" type="search" value="${escapeAttribute(currentSheet.query)}" data-filter-search="tags" placeholder="Search tags">
          </label>
        ` : ""}
        <div class="filter-choice-grid" data-filter-choices="${kind}">
          ${choices || `<p class="muted small">${isTags ? "No tags yet." : "No categories are in use yet."}</p>`}
        </div>
        <div class="sheet-actions">
          <button class="button ghost" type="button" data-action="clear-filters" data-filter-kind="${kind}">Clear</button>
          <button class="button primary" type="button" data-action="filter-done">Done</button>
        </div>
      </section>
    </div>
  `;
  bindSheetDrag();
  requestAnimationFrame(() => {
    const sheet = sheetsRoot.querySelector(".sheet");
    if (sheet) sheet.scrollTop = previousScroll;
    if (focusSearch || searchWasFocused) {
      const search = sheetsRoot.querySelector('[data-filter-search="tags"]');
      search?.focus({ preventScroll: true });
      search?.setSelectionRange(search.value.length, search.value.length);
    }
  });
}

function renderTagFilterChoices(tags) {
  return tags.map((tag) => {
    const active = activeFilters.tags.includes(tag);
    return `<button class="chip filter-choice ${active ? "active" : ""}" type="button"
      data-action="toggle-filter-tag" data-filter-tag="${escapeAttribute(tag)}" aria-pressed="${active}">#${escapeHtml(tag)}</button>`;
  }).join("");
}

function renderColorFilterChoices(colors) {
  return colors.map((color) => {
    const active = activeFilters.colors.includes(color);
    return `<button class="color-filter-choice ${active ? "selected" : ""}" type="button"
      data-action="toggle-filter-color" data-filter-color="${color}" data-color="${color}"
      style="--swatch:${color}" aria-label="${color} category" aria-pressed="${active}">
      <span class="color-swatch" aria-hidden="true"></span>
    </button>`;
  }).join("");
}

function toggleFilter(kind, value) {
  if (!value || !["colors", "tags"].includes(kind)) return;
  const values = activeFilters[kind];
  activeFilters = {
    ...activeFilters,
    [kind]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
  };
  rerender();
  renderFilterSheet();
}

function clearFilters(kind) {
  if (kind === "colors" || kind === "tags") activeFilters = { ...activeFilters, [kind]: [] };
  else activeFilters = { colors: [], tags: [] };
  rerender();
  if (currentSheet?.type === "filter") renderFilterSheet();
}

function openQuietHoursSheet() {
  currentSheet = { type: "quiet-hours" };
  document.body.classList.add("sheet-open");
  sheetsRoot.innerHTML = `
    <div class="sheet-layer" role="presentation">
      <button class="sheet-scrim" type="button" data-action="close-sheet" aria-label="Close quiet hours"></button>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="quiet-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="sheet-header">
          <div><h2 class="sheet-title" id="quiet-title">Quiet hours</h2><p class="sheet-subtitle">Interval reminders wait until quiet hours end. Due-time alerts still fire when you chose.</p></div>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close">×</button>
        </header>
        <div class="date-fields">
          <label class="field"><span class="field-label">Start</span><input class="input" id="quiet-start" type="time" data-show-picker value="${escapeAttribute(documentState.settings.quietStart)}"></label>
          <label class="field"><span class="field-label">End</span><input class="input" id="quiet-end" type="time" data-show-picker value="${escapeAttribute(documentState.settings.quietEnd)}"></label>
        </div>
        <div class="sheet-actions single"><button class="button primary full" type="button" data-action="save-quiet-hours">Save quiet hours</button></div>
      </section>
    </div>
  `;
  bindSheetDrag();
}

function saveQuietHours() {
  if (currentSheet?.type !== "quiet-hours") return;
  const start = sheetsRoot.querySelector("#quiet-start")?.value;
  const end = sheetsRoot.querySelector("#quiet-end")?.value;
  if (!isClockValue(start) || !isClockValue(end)) {
    showToast("Choose a valid start and end time.");
    return;
  }
  documentState.settings.quietStart = start;
  documentState.settings.quietEnd = end;
  scheduleSave();
  closeSheet();
  rerender();
  showToast("Quiet hours saved");
}

function isClockValue(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value));
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function openAddSheet() {
  currentSheet = {
    type: "editor",
    mode: "add",
    taskId: null,
    activeOption: null,
    draft: createEditorDraft(),
  };
  document.body.classList.add("sheet-open");
  renderEditorSheet({ autoFocus: true });
}

function openEditSheet(taskId) {
  const task = documentState.tasks.find((item) => item.id === taskId);
  if (!task) return;
  currentSheet = {
    type: "editor",
    mode: "edit",
    taskId,
    activeOption: null,
    draft: createEditorDraft(task),
  };
  document.body.classList.add("sheet-open");
  renderEditorSheet();
}

function createEditorDraft(task = null) {
  const due = task?.due ? new Date(task.due) : null;
  const draft = {
    source: "",
    title: task?.title || "",
    notes: task?.notes || "",
    due: task?.due ?? null,
    allDay: Boolean(task?.allDay),
    dateValue: due ? dateKey(due) : "",
    timeValue: due && !task?.allDay ? timeInputValue(due) : "",
    priority: task?.priority ?? 1,
    color: task?.color ?? null,
    tags: [...(task?.tags ?? [])],
    reminder: task?.reminder ? { ...task.reminder } : null,
    intervalMin: task?.reminder?.intervalMin ?? 30,
    timer: task?.timer ? { ...task.timer } : null,
    timerMin: task?.timer?.durationMin ?? 30,
    breaks: task?.breaks ? { ...task.breaks } : null,
    workMin: task?.breaks?.workMin ?? 25,
    breakMin: task?.breaks?.breakMin ?? 5,
    muteDuringSession: task?.muteDuringSession !== false,
    clearedTypes: new Set(),
    parsed: { parsed: [], title: task?.title || "" },
  };
  return draft;
}

function renderEditorSheet({ autoFocus = false } = {}) {
  if (currentSheet?.type !== "editor") return;
  const previousScroll = sheetsRoot.querySelector(".sheet")?.scrollTop || 0;
  const { mode, taskId, draft, activeOption } = currentSheet;
  const isAdd = mode === "add";
  sheetsRoot.innerHTML = `
    <div class="sheet-layer" role="presentation">
      <button class="sheet-scrim" type="button" data-action="close-sheet" aria-label="Close ${isAdd ? "add task" : "task editor"}"></button>
      <section class="sheet editor-sheet" role="dialog" aria-modal="true" aria-labelledby="editor-sheet-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="sheet-header">
          <h2 class="sheet-title" id="editor-sheet-title">${isAdd ? "Add task" : "Edit task"}</h2>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close">×</button>
        </header>
        ${isAdd ? `
          <label class="field">
            <span class="field-label">What do you need to do?</span>
            <input class="input quick-input" id="quick-task-input" data-field="source" type="text" autocomplete="off"
              value="${escapeAttribute(draft.source)}" placeholder="Call Mom tomorrow 5pm #family">
          </label>
          <div class="chip-row parsed-preview" id="parsed-preview">${renderParsedChips(draft)}</div>
          <p class="parse-hint">Try a day, time, interval, priority, or #tag. Interval timing is saved now; background delivery is not active until the notification round.</p>
        ` : `
          <label class="field">
            <span class="field-label">Title</span>
            <input class="input" id="edit-task-title" data-field="title" type="text" value="${escapeAttribute(draft.title)}">
          </label>
        `}
        <div class="option-toolbar" aria-label="Task options">${renderOptionToolbar(draft, activeOption)}</div>
        <div class="option-panel-wrap">${renderOptionPanel(activeOption, draft)}</div>
        <div class="sheet-actions ${isAdd ? "single" : ""}">
          ${isAdd ? "" : `<button class="button danger" type="button" data-action="delete-task" data-task-id="${taskId}">Delete</button>`}
          <button class="button primary ${isAdd ? "full" : ""}" type="button" data-action="${isAdd ? "add-task" : "save-edit"}" ${isAdd ? "" : `data-task-id="${taskId}"`}>${isAdd ? "Add task" : "Save"}</button>
        </div>
      </section>
    </div>
  `;
  bindSheetDrag();
  requestAnimationFrame(() => {
    const sheet = sheetsRoot.querySelector(".sheet");
    if (sheet) sheet.scrollTop = previousScroll;
    if (autoFocus) sheetsRoot.querySelector("#quick-task-input")?.focus({ preventScroll: true });
  });
}

function renderOptionToolbar(draft, activeOption) {
  return ["date", "timing", "priority", "color", "tags", "notes"].map((option) => {
    const summary = optionSummary(option, draft);
    const set = optionIsSet(option, draft);
    return `
      <button class="chip option-chip ${set ? "set" : ""} ${activeOption === option ? "open" : ""}" type="button"
        data-action="task-option" data-option="${option}" data-touch-action="true" aria-expanded="${activeOption === option}">
        ${optionIcon(option)}<span>${capitalize(option)}${summary ? `<small>${escapeHtml(summary)}</small>` : ""}</span>
      </button>
    `;
  }).join("");
}

function optionIcon(option) {
  const paths = {
    date: '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 9h16"></path>',
    timing: '<circle cx="12" cy="13" r="8"></circle><path d="M12 9v5l3 2M9 3h6"></path>',
    priority: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"></path>',
    color: '<circle cx="12" cy="12" r="8"></circle><path d="M12 4a8 8 0 0 0 0 16c2 0 2-3 0-3h-1a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4"></path>',
    tags: '<path d="M4 5v6l8 8 7-7-8-8H5a1 1 0 0 0-1 1Z"></path><circle cx="8" cy="8" r="1"></circle>',
    notes: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"></path>',
  };
  return `<svg class="chip-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[option]}</svg>`;
}

function optionSummary(option, draft) {
  if (option === "date" && draft.due) return formatDraftDue(draft);
  if (option === "timing") {
    const values = [];
    if (draft.reminder) values.push(`every ${formatMinutes(draft.reminder.intervalMin)} · pending`);
    if (draft.timer) values.push(`${formatMinutes(draft.timer.durationMin)} timer`);
    if (draft.breaks) values.push(`${draft.breaks.workMin}/${draft.breaks.breakMin}`);
    return values.join(" · ");
  }
  if (option === "priority" && draft.priority !== 1) return draft.priority === 2 ? "high" : "low";
  if (option === "color" && draft.color) return "●";
  if (option === "tags" && draft.tags.length) return `#${draft.tags[0]}${draft.tags.length > 1 ? ` +${draft.tags.length - 1}` : ""}`;
  if (option === "notes" && draft.notes.trim()) return "●";
  return "";
}

function optionIsSet(option, draft) {
  return Boolean(optionSummary(option, draft));
}

function renderOptionPanel(option, draft) {
  if (!option) return "";
  if (option === "date") return `
    <section class="option-panel" data-option-panel="date">
      <div class="date-fields">
        <label class="field"><span class="field-label">Date</span><input class="input" type="date" data-field="due-date" data-show-picker value="${draft.dateValue}"></label>
        <label class="field"><span class="field-label">Time (optional)</span><input class="input" type="time" data-field="due-time" data-show-picker value="${draft.timeValue}"></label>
      </div>
      ${draft.due ? `<button class="button ghost compact-button" type="button" data-action="remove-parsed" data-type="due">Clear date</button>` : ""}
    </section>`;
  if (option === "timing") return renderTimingPanel(draft);
  if (option === "priority") return `
    <section class="option-panel" data-option-panel="priority">
      <div class="segmented" role="group" aria-label="Priority">
        ${[[0, "Low"], [1, "Normal"], [2, "High"]].map(([value, label]) => `<button class="segmented-option ${draft.priority === value ? "selected" : ""}" type="button" data-action="set-draft-priority" data-priority="${value}">${label}</button>`).join("")}
      </div>
    </section>`;
  if (option === "color") return `
    <section class="option-panel" data-option-panel="color">
      <div class="color-picker" role="group" aria-label="Task color">
        <button class="color-choice none ${!draft.color ? "selected" : ""}" type="button" data-action="set-draft-color" data-color="" aria-label="No color">×</button>
        ${CATEGORY_COLORS.map((color) => `<button class="color-choice ${draft.color === color ? "selected" : ""}" type="button" data-action="set-draft-color" data-color="${color}" style="--swatch:${color}" aria-label="Choose ${color}"></button>`).join("")}
      </div>
    </section>`;
  if (option === "tags") return `
    <section class="option-panel" data-option-panel="tags">
      <label class="field"><span class="field-label">Tags</span><input class="input" type="text" data-field="tags" value="${escapeAttribute(draft.tags.join(", "))}" placeholder="bills, family, errands"></label>
      <p class="field-help">Separate tags with commas. The # is optional.</p>
    </section>`;
  return `
    <section class="option-panel" data-option-panel="notes">
      <label class="field"><span class="field-label">Notes</span><textarea class="textarea" data-field="notes" placeholder="Anything useful…">${escapeHtml(draft.notes)}</textarea></label>
    </section>`;
}

function renderTimingPanel(draft) {
  return `
    <section class="option-panel" data-option-panel="timing">
      ${renderTimingSwitch("Notify me every… (delivery next round)", "reminder-enabled", Boolean(draft.reminder), draft.reminder ? `
        <label class="inline-duration"><span>Every</span><input class="input duration-input" type="number" inputmode="numeric" min="1" max="1440" data-field="interval-min" value="${draft.intervalMin}"><span>minutes</span></label>` : "")}
      ${renderTimingSwitch("Task timer", "timer-enabled", Boolean(draft.timer), draft.timer ? `
        <label class="inline-duration"><span>Duration</span><input class="input duration-input" type="number" inputmode="numeric" min="1" max="1440" data-field="timer-min" value="${draft.timerMin}"><span>minutes</span></label>` : "")}
      ${renderTimingSwitch("Breaks", "breaks-enabled", Boolean(draft.breaks), draft.breaks ? `
        <div class="duration-pair">
          <label class="inline-duration"><span>Work</span><input class="input duration-input" type="number" inputmode="numeric" min="1" max="240" data-field="work-min" value="${draft.workMin}"><span>min</span></label>
          <label class="inline-duration"><span>Break</span><input class="input duration-input" type="number" inputmode="numeric" min="1" max="120" data-field="break-min" value="${draft.breakMin}"><span>min</span></label>
        </div>` : "")}
      ${draft.timer || draft.breaks ? renderTimingSwitch("Silence intervals during a session", "mute-session", draft.muteDuringSession) : ""}
      <p class="field-help timing-note">Minute entry is functional in this build. The scroll-wheel control ships with background notifications.</p>
    </section>`;
}

function renderTimingSwitch(label, field, checked, details = "") {
  return `<div class="timing-row">
    <label class="switch-row"><span>${label}</span><input type="checkbox" role="switch" data-field="${field}" ${checked ? "checked" : ""}><span class="switch-track" aria-hidden="true"></span></label>
    ${details}
  </div>`;
}

function renderParsedChips(draft) {
  let dueRendered = false;
  return (draft.parsed?.parsed ?? []).filter((token) => {
    if (!['date', 'time'].includes(token.type)) return true;
    if (dueRendered) return false;
    dueRendered = true;
    return true;
  }).map((token) => {
    const type = ['date', 'time'].includes(token.type) ? 'due' : token.type;
    return `
    <button class="chip set parsed-chip" type="button" data-action="remove-parsed" data-type="${escapeAttribute(type)}" aria-label="Remove ${escapeAttribute(token.label)}">
      ${escapeHtml(token.label)} <span aria-hidden="true">×</span>
    </button>
  `;
  }).join("");
}

function closeSheet() {
  currentSheet = null;
  sheetsRoot.replaceChildren();
  document.body.classList.remove("sheet-open");
}

function submitAddTask() {
  if (currentSheet?.type !== "editor" || currentSheet.mode !== "add") return;
  captureVisibleDraft();
  const { draft } = currentSheet;
  const source = draft.source.trim();
  if (!source) {
    sheetsRoot.querySelector("#quick-task-input")?.focus();
    showToast("Give the task a name first.");
    return;
  }

  const now = Date.now();
  documentState = withAddedTask(documentState, {
    title: draft.title.trim() || source,
    notes: draft.notes,
    due: draft.due,
    allDay: draft.allDay,
    priority: draft.priority,
    tags: draft.tags,
    color: draft.color,
    reminder: draft.reminder,
    timer: draft.timer,
    breaks: draft.breaks,
    muteDuringSession: draft.muteDuringSession,
    session: null,
    parentId: null,
    collapsed: false,
    archived: false,
    completedAt: null,
  }, now);
  scheduleSave();
  closeSheet();
  if (currentRoute !== "tasks") location.hash = "#tasks";
  else rerender({ entry: true });
  showToast("Task added");
}

function saveTaskEdit(taskId) {
  const task = documentState.tasks.find((item) => item.id === taskId);
  if (currentSheet?.type !== "editor") return;
  captureVisibleDraft();
  const { draft } = currentSheet;
  const title = draft.title.trim();
  if (!task || !title) return;
  task.title = title;
  task.notes = draft.notes.trim();
  task.due = draft.due;
  task.allDay = draft.allDay;
  task.priority = draft.priority;
  task.color = draft.color;
  task.tags = [...draft.tags];
  task.reminder = draft.reminder ? { ...draft.reminder } : null;
  task.timer = draft.timer ? { ...draft.timer } : null;
  task.breaks = draft.breaks ? { ...draft.breaks } : null;
  task.muteDuringSession = draft.muteDuringSession;
  if (!task.timer && !task.breaks) task.session = null;
  scheduleSave();
  closeSheet();
  rerender();
  showToast("Task saved");
}

function handleSheetInput(target, eventType = "input") {
  if (target?.dataset.filterSearch === "tags" && currentSheet?.type === "filter") {
    currentSheet.query = target.value;
    const tasks = documentState.tasks.filter((task) => !task.archived);
    const tags = [...new Set([...inUseTags(tasks), ...activeFilters.tags])].sort((a, b) => a.localeCompare(b));
    const choices = sheetsRoot.querySelector('[data-filter-choices="tags"]');
    if (choices) {
      choices.innerHTML = renderTagFilterChoices(searchTags(tags, currentSheet.query))
        || '<p class="muted small">No matching tags.</p>';
    }
    return;
  }
  if (currentSheet?.type !== "editor" || !target?.dataset.field) return;
  const { draft } = currentSheet;
  const field = target.dataset.field;
  let rerenderPanel = false;

  if (field === "source") {
    draft.source = target.value;
    applyQuickSourceToDraft(draft);
    refreshEditorChrome();
    return;
  }
  if (field === "title") draft.title = target.value;
  if (field === "notes") draft.notes = target.value;
  if (field === "tags") {
    draft.tags = normalizeTagInput(target.value);
    draft.clearedTypes.add("tags");
  }
  if (field === "due-date" || field === "due-time") {
    draft.dateValue = sheetsRoot.querySelector('[data-field="due-date"]')?.value || "";
    draft.timeValue = sheetsRoot.querySelector('[data-field="due-time"]')?.value || "";
    updateDraftDue(draft);
    draft.clearedTypes.add("due");
    if (eventType === "change" && target.matches(":focus")) target.blur();
  }
  if (field === "reminder-enabled") {
    draft.reminder = target.checked ? { intervalMin: draft.intervalMin, startAt: null } : null;
    draft.clearedTypes.add("reminder");
    rerenderPanel = true;
  }
  if (field === "timer-enabled") {
    draft.timer = target.checked ? { durationMin: draft.timerMin } : null;
    rerenderPanel = true;
  }
  if (field === "breaks-enabled") {
    draft.breaks = target.checked ? { workMin: draft.workMin, breakMin: draft.breakMin } : null;
    rerenderPanel = true;
  }
  if (field === "mute-session") draft.muteDuringSession = target.checked;
  if (field === "interval-min") {
    draft.intervalMin = clampMinutes(target.value, 1, 1440, 30);
    if (draft.reminder) draft.reminder.intervalMin = draft.intervalMin;
    draft.clearedTypes.add("reminder");
  }
  if (field === "timer-min") {
    draft.timerMin = clampMinutes(target.value, 1, 1440, 30);
    if (draft.timer) draft.timer.durationMin = draft.timerMin;
  }
  if (field === "work-min") {
    draft.workMin = clampMinutes(target.value, 1, 240, 25);
    if (draft.breaks) draft.breaks.workMin = draft.workMin;
  }
  if (field === "break-min") {
    draft.breakMin = clampMinutes(target.value, 1, 120, 5);
    if (draft.breaks) draft.breaks.breakMin = draft.breakMin;
  }

  if (rerenderPanel) renderEditorSheet();
  else refreshEditorToolbar();
}

function captureVisibleDraft() {
  if (currentSheet?.type !== "editor") return;
  const { draft } = currentSheet;
  const source = sheetsRoot.querySelector('[data-field="source"]');
  const title = sheetsRoot.querySelector('[data-field="title"]');
  const notes = sheetsRoot.querySelector('[data-field="notes"]');
  const tags = sheetsRoot.querySelector('[data-field="tags"]');
  if (source) {
    draft.source = source.value;
    applyQuickSourceToDraft(draft);
  }
  if (title) draft.title = title.value;
  if (notes) draft.notes = notes.value;
  if (tags) draft.tags = normalizeTagInput(tags.value);
}

function applyQuickSourceToDraft(draft) {
  const parsed = parseQuickAdd(draft.source, { clearedTypes: [...draft.clearedTypes] });
  draft.parsed = parsed;
  draft.title = parsed.title || draft.source.trim();
  if (!draft.clearedTypes.has("due")) {
    draft.due = parsed.due;
    draft.allDay = parsed.allDay;
    const due = parsed.due ? new Date(parsed.due) : null;
    draft.dateValue = due ? dateKey(due) : "";
    draft.timeValue = due && !parsed.allDay ? timeInputValue(due) : "";
  }
  if (!draft.clearedTypes.has("reminder")) {
    draft.reminder = parsed.reminder ? { ...parsed.reminder } : null;
    if (parsed.reminder) draft.intervalMin = parsed.reminder.intervalMin;
  }
  if (!draft.clearedTypes.has("priority")) draft.priority = parsed.priority ?? 1;
  if (!draft.clearedTypes.has("tags")) draft.tags = [...parsed.tags];
}

function refreshEditorChrome() {
  if (currentSheet?.type !== "editor") return;
  const preview = sheetsRoot.querySelector("#parsed-preview");
  if (preview) preview.innerHTML = renderParsedChips(currentSheet.draft);
  refreshEditorToolbar();
}

function refreshEditorToolbar() {
  if (currentSheet?.type !== "editor") return;
  const toolbar = sheetsRoot.querySelector(".option-toolbar");
  if (toolbar) toolbar.innerHTML = renderOptionToolbar(currentSheet.draft, currentSheet.activeOption);
}

function toggleTaskOption(option) {
  if (currentSheet?.type !== "editor" || !["date", "timing", "priority", "color", "tags", "notes"].includes(option)) return;
  captureVisibleDraft();
  currentSheet.activeOption = currentSheet.activeOption === option ? null : option;
  renderEditorSheet();
}

function removeParsedType(type) {
  if (currentSheet?.type !== "editor") return;
  const { draft } = currentSheet;
  const normalized = type === "date" || type === "time" ? "due" : type;
  draft.clearedTypes.add(normalized);
  if (normalized === "due") {
    draft.due = null;
    draft.allDay = false;
    draft.dateValue = "";
    draft.timeValue = "";
  } else if (normalized === "reminder") {
    draft.reminder = null;
  } else if (normalized === "priority") {
    draft.priority = 1;
  } else if (normalized === "tags") {
    draft.tags = [];
  }
  if (currentSheet.mode === "add") applyQuickSourceToDraft(draft);
  renderEditorSheet();
}

function setDraftPriority(priority) {
  if (currentSheet?.type !== "editor" || ![0, 1, 2].includes(priority)) return;
  currentSheet.draft.priority = priority;
  currentSheet.draft.clearedTypes.add("priority");
  renderEditorSheet();
}

function setDraftColor(color) {
  if (currentSheet?.type !== "editor") return;
  currentSheet.draft.color = CATEGORY_COLORS.includes(String(color).toLowerCase()) ? String(color).toLowerCase() : null;
  renderEditorSheet();
}

function updateDraftDue(draft) {
  if (!draft.dateValue && !draft.timeValue) {
    draft.due = null;
    draft.allDay = false;
    return;
  }
  const day = draft.dateValue ? parseDateKey(draft.dateValue) : new Date();
  if (Number.isNaN(day.getTime())) {
    draft.due = null;
    return;
  }
  if (draft.timeValue) {
    const [hour, minute] = draft.timeValue.split(":").map(Number);
    day.setHours(hour, minute, 0, 0);
    draft.allDay = false;
  } else {
    day.setHours(23, 59, 59, 999);
    draft.allDay = true;
  }
  draft.due = day.getTime();
}

function bindSheetDrag() {
  const sheet = sheetsRoot.querySelector(".sheet");
  if (!sheet) return;
  let drag = null;
  const controls = "input, textarea, select, button, a, label, [role='switch'], .chip, .segmented, .timing-row";
  sheet.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || event.target.closest(controls) || sheet.scrollTop > 0) return;
    drag = { y: event.touches[0].clientY, delta: 0 };
    sheet.classList.add("dragging-sheet");
  }, { passive: true });
  sheet.addEventListener("touchmove", (event) => {
    if (!drag) return;
    drag.delta = Math.max(0, event.touches[0].clientY - drag.y);
    if (drag.delta > 4) event.preventDefault();
    sheet.style.transform = `translateY(${Math.min(160, drag.delta)}px)`;
  }, { passive: false });
  sheet.addEventListener("touchend", () => {
    if (!drag) return;
    const shouldClose = drag.delta > 110;
    drag = null;
    sheet.classList.remove("dragging-sheet");
    sheet.style.transform = "";
    if (shouldClose) closeSheet();
  }, { passive: true });
  sheet.addEventListener("touchcancel", () => {
    drag = null;
    sheet.classList.remove("dragging-sheet");
    sheet.style.transform = "";
  }, { passive: true });
}

function normalizeTagInput(value) {
  return [...new Set(String(value).split(",")
    .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase())
    .filter(Boolean))];
}

function clampMinutes(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function timeInputValue(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDraftDue(draft) {
  const date = new Date(draft.due);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(draft.allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(date);
}

function formatMinutes(value) {
  return value >= 60 && value % 60 === 0 ? `${value / 60}h` : `${value}m`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function deleteTask(taskId, confirmed = false) {
  const result = deleteTaskFromModel(documentState.tasks, taskId);
  if (!result.deletedIds.length) return;
  if (result.deletedIds.length > 1 && !confirmed) {
    currentSheet = { type: "delete-confirm", taskId, count: result.deletedIds.length - 1 };
    document.body.classList.add("sheet-open");
    renderDeleteConfirmation();
    return;
  }
  documentState.tasks = result.tasks;
  scheduleSave();
  closeSheet();
  rerender();
  showToast(result.deletedIds.length > 1 ? `Deleted task and ${result.deletedIds.length - 1} subtasks` : "Task deleted");
}

function renderDeleteConfirmation() {
  if (currentSheet?.type !== "delete-confirm") return;
  const { taskId, count } = currentSheet;
  sheetsRoot.innerHTML = `
    <div class="sheet-layer" role="presentation">
      <button class="sheet-scrim" type="button" data-action="close-sheet" aria-label="Cancel delete"></button>
      <section class="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="sheet-header">
          <h2 class="sheet-title" id="delete-title">Delete this task?</h2>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close">×</button>
        </header>
        <p class="confirm-copy">This also deletes ${count} ${count === 1 ? "subtask" : "subtasks"}. This cannot be undone.</p>
        <div class="sheet-actions">
          <button class="button ghost" type="button" data-action="close-sheet">Cancel</button>
          <button class="button danger" type="button" data-action="confirm-delete-task" data-task-id="${taskId}">Delete all</button>
        </div>
      </section>
    </div>
  `;
  bindSheetDrag();
}

function toggleTask(taskId) {
  const result = completeWithDescendants(documentState.tasks, taskId, Date.now());
  if (!result.previousStates.length) return;
  documentState.tasks = result.completed ? setArchived(result.tasks, taskId, true) : result.tasks;
  scheduleSave();
  rerender();
  const descendantCount = result.previousStates.length - 1;
  showToast(result.completed ? `Done${descendantCount ? ` (+${descendantCount} subtasks)` : ""}` : "Moved back to open tasks", result.completed ? () => {
    documentState.tasks = restoreTaskStates(documentState.tasks, result.previousStates);
    scheduleSave();
    rerender();
  } : null);
}

function toggleSession(taskId) {
  const task = documentState.tasks.find((item) => item.id === taskId);
  if (!task || task.completedAt || task.archived || (!task.timer && !task.breaks)) return;
  const stopping = Boolean(task.session);
  task.session = stopping ? null : { startedAt: Date.now() };
  scheduleSave();
  rerender();
  showToast(stopping ? "Focus session stopped" : "Focus session started");
}

function selectTheme(themeId) {
  if (!themes[themeId]) return;
  documentState.settings.theme = themeId;
  selectedThemeFamily = themes[themeId].family;
  applyTheme(themeId);
  scheduleSave();
  rerender();
}

async function exportBackup() {
  const contents = serializeData(documentState);
  const filename = `taskfocus-backup-${dateKey(new Date())}.json`;
  const file = new File([contents], filename, { type: "application/json" });
  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: "TaskFocus backup", files: [file] });
      showToast("Backup ready to save or share");
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  showToast("Backup downloaded");
}

function chooseImportBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = prepareImportedData(await file.text());
      currentSheet = { type: "import-confirm", imported };
      document.body.classList.add("sheet-open");
      renderImportConfirmation();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That backup could not be read.");
    }
  }, { once: true });
  input.click();
}

function renderImportConfirmation() {
  if (currentSheet?.type !== "import-confirm") return;
  const count = currentSheet.imported.tasks.length;
  sheetsRoot.innerHTML = `
    <div class="sheet-layer" role="presentation">
      <button class="sheet-scrim" type="button" data-action="close-sheet" aria-label="Cancel import"></button>
      <section class="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="import-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="sheet-header">
          <h2 class="sheet-title" id="import-title">Replace everything?</h2>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close">×</button>
        </header>
        <p class="confirm-copy">Replace everything with this backup (${count} ${count === 1 ? "task" : "tasks"})? Your current data remains in the automatic safety backup until the next change.</p>
        <div class="sheet-actions">
          <button class="button ghost" type="button" data-action="close-sheet">Cancel</button>
          <button class="button danger" type="button" data-action="confirm-import">Replace everything</button>
        </div>
      </section>
    </div>
  `;
  bindSheetDrag();
}

function confirmImport() {
  if (currentSheet?.type !== "import-confirm") return;
  const imported = currentSheet.imported;
  if (!persistDocumentNow(imported, { backupDocument: documentState })) return;
  documentState = imported;
  activeFilters = { colors: [], tags: [] };
  selectedThemeFamily = themes[documentState.settings.theme]?.family || "ember";
  applyTheme(documentState.settings.theme);
  closeSheet();
  rerender({ entry: true });
  showToast("Backup restored");
}

function showToast(message, undo = null) {
  const toast = document.createElement("div");
  toast.className = "toast";
  const label = document.createElement("span");
  label.textContent = message;
  toast.append(label);
  if (undo) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Undo";
    button.addEventListener("click", () => {
      undo();
      toast.remove();
    }, { once: true });
    toast.append(button);
  }
  toastsRoot.append(toast);
  setTimeout(() => toast.remove(), 4_000);
}

function showUpdateToast(update) {
  if (!update?.available) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  const label = document.createElement("span");
  label.textContent = `Update available: ${update.versionName}`;
  const link = document.createElement("a");
  link.className = "toast-action";
  link.href = update.releaseUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Get it";
  toast.append(label, link);
  toastsRoot.append(toast);
  setTimeout(() => toast.remove(), 12_000);
}

async function checkForUpdates() {
  const update = await checkForNativeUpdate();
  showUpdateToast(update);
}

async function loadBuildVersion({ reloadOnChange = false } = {}) {
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const nextBuild = String(payload.build || "development").slice(0, 12);
    const loadedBuildKey = "taskfocus.loaded-build";
    const loaded = localStorage.getItem(loadedBuildKey);
    buildLabel = nextBuild;
    buildVersionName = String(payload.versionName || (payload.versionCode ? `1.0.${payload.versionCode}` : "development"));
    if (reloadOnChange && loaded && loaded !== nextBuild) {
      localStorage.setItem(loadedBuildKey, nextBuild);
      location.reload();
      return;
    }
    localStorage.setItem(loadedBuildKey, nextBuild);
    if (currentRoute === "settings") rerender();
  } catch {
    // Offline is a supported state; the installed build keeps running.
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || isNative) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch {
    // Pages preview still works when registration is unavailable.
  }
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parentTitle(task) {
  if (!task?.parentId) return "";
  return documentState.tasks.find((candidate) => candidate.id === task.parentId)?.title || "";
}

function safeColor(value) {
  const normalized = String(value).toLowerCase();
  return CATEGORY_COLORS.includes(normalized) ? normalized : "var(--text-faint)";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
