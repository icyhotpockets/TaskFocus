import { isNative, platformName } from "./native.js";
import {
  BACKUP_KEY,
  STORAGE_KEY,
  createEmptyData,
  migrateData,
  withAddedTask,
} from "./core/data.js";
import { pickFocusTasks, groupTasksByDate } from "./core/focus.js";
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
const routeScroll = new Map();

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
      if (raw) return normalizeDocument(JSON.parse(raw));
    } catch {
      // Try the last-known-good copy, then start clean.
    }
  }
  return defaultDocument();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) localStorage.setItem(BACKUP_KEY, current);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(documentState));
    } catch {
      showToast("TaskFocus could not save this change.");
    }
  }, 250);
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
    if (!actionTarget) return;
    const { action } = actionTarget.dataset;

    if (action === "close-sheet") {
      closeSheet();
    } else if (action === "add-task") {
      submitAddTask();
    } else if (action === "toggle-task") {
      event.stopPropagation();
      toggleTask(Number(actionTarget.dataset.taskId));
    } else if (action === "edit-task") {
      openEditSheet(Number(actionTarget.dataset.taskId));
    } else if (action === "save-edit") {
      saveTaskEdit(Number(actionTarget.dataset.taskId));
    } else if (action === "delete-task") {
      deleteTask(Number(actionTarget.dataset.taskId));
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
    } else if (action === "placeholder") {
      showToast("This control is ready for the next build round.");
    }
  });

  sheetsRoot.addEventListener("input", (event) => {
    if (event.target.id === "quick-task-input") updateParsedPreview(event.target.value);
  });

  sheetsRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
    if (event.key === "Enter" && event.target.id === "quick-task-input") {
      event.preventDefault();
      submitAddTask();
    }
  });
}

function rerender({ entry = false, restoreRouteScroll = false } = {}) {
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
        <button class="chip" type="button" data-action="placeholder">
          <span class="chip-dot" style="--chip-color:var(--accent-bright)"></span> Category
        </button>
        <button class="chip" type="button" data-action="placeholder"># Tags</button>
      </div>

      ${open.length === 0 ? renderEmptyState() : `
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

function renderTaskSection(title, tasks, key, focus = false) {
  return `
    <section class="section" aria-labelledby="section-${key}">
      <div class="section-heading-row">
        <h2 id="section-${key}">${escapeHtml(title)}</h2>
        <span class="section-count">${tasks.length}${focus ? ` of ${documentState.settings.focusLimit}` : ""}</span>
      </div>
      <div class="task-list">${tasks.map((task, index) => renderTaskCard(task, index)).join("")}</div>
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
          ${due || timer || priority || category || tag ? `<div class="task-meta">${category}${due}${timer}${priority}${tag}</div>` : ""}
        </div>
        <div class="task-trailing">
          ${task.timer || task.breaks ? `
            <button class="icon-button" type="button" data-action="placeholder" aria-label="Start focus session">
              <svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5Z"></path></svg>
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
  const elapsed = Math.max(0, Date.now() - Number(task.session.startedAt));
  const total = (task.timer?.durationMin || task.breaks?.workMin || 25) * 60_000;
  return `${Math.max(0, Math.ceil((total - elapsed) / 60_000))}m left`;
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
            <div class="setting-label"><strong>Permission</strong><span>Not enabled yet</span></div>
            <button class="button" type="button" data-action="placeholder">Enable</button>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>Quiet hours</strong><span>${documentState.settings.quietStart}–${documentState.settings.quietEnd}</span></div>
            <button class="button ghost" type="button" data-action="placeholder">Edit</button>
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
            <button class="button" type="button" data-action="placeholder">Export</button>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>Import backup</strong><span>Replace tasks from a saved copy</span></div>
            <button class="button ghost" type="button" data-action="placeholder">Import</button>
          </div>
        </section>

        <section class="settings-card" style="--i:4">
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

function openAddSheet() {
  currentSheet = { type: "add" };
  document.body.classList.add("sheet-open");
  sheetsRoot.innerHTML = `
    <div class="sheet-layer" role="presentation">
      <button class="sheet-scrim" type="button" data-action="close-sheet" aria-label="Close add task"></button>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="add-sheet-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="sheet-header">
          <h2 class="sheet-title" id="add-sheet-title">Add task</h2>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close">×</button>
        </header>
        <label class="field">
          <span class="field-label">What do you need to do?</span>
          <input class="input quick-input" id="quick-task-input" type="text" autocomplete="off" placeholder="Call Mom tomorrow 5pm #family">
        </label>
        <div class="chip-row" id="parsed-preview"></div>
        <p class="parse-hint">Try a day, time, priority, or #tag. You can refine it later.</p>
        <div class="option-toolbar" aria-label="Task options">
          ${["Date", "Timing", "Priority", "Color", "Tags", "Notes"].map((label) => `<button class="chip" type="button" data-action="placeholder">${label}</button>`).join("")}
        </div>
        <div class="sheet-actions single">
          <button class="button primary full" type="button" data-action="add-task">Add task</button>
        </div>
      </section>
    </div>
  `;
  const input = sheetsRoot.querySelector("#quick-task-input");
  requestAnimationFrame(() => input?.focus({ preventScroll: true }));
}

function openEditSheet(taskId) {
  const task = documentState.tasks.find((item) => item.id === taskId);
  if (!task) return;
  currentSheet = { type: "edit", taskId };
  document.body.classList.add("sheet-open");
  sheetsRoot.innerHTML = `
    <div class="sheet-layer" role="presentation">
      <button class="sheet-scrim" type="button" data-action="close-sheet" aria-label="Close task editor"></button>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="edit-sheet-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="sheet-header">
          <h2 class="sheet-title" id="edit-sheet-title">Edit task</h2>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close">×</button>
        </header>
        <label class="field">
          <span class="field-label">Title</span>
          <input class="input" id="edit-task-title" type="text" value="${escapeAttribute(task.title)}">
        </label>
        <label class="field">
          <span class="field-label">Notes</span>
          <textarea class="textarea" id="edit-task-notes" placeholder="Anything useful…">${escapeHtml(task.notes || "")}</textarea>
        </label>
        <div class="option-toolbar" aria-label="Task options">
          ${["Date", "Timing", "Priority", "Color", "Tags"].map((label) => `<button class="chip" type="button" data-action="placeholder">${label}</button>`).join("")}
        </div>
        <div class="sheet-actions">
          <button class="button danger" type="button" data-action="delete-task" data-task-id="${task.id}">Delete</button>
          <button class="button primary" type="button" data-action="save-edit" data-task-id="${task.id}">Save</button>
        </div>
      </section>
    </div>
  `;
}

function closeSheet() {
  currentSheet = null;
  sheetsRoot.replaceChildren();
  document.body.classList.remove("sheet-open");
}

function submitAddTask() {
  const input = sheetsRoot.querySelector("#quick-task-input");
  const source = input?.value.trim() || "";
  if (!source) {
    input?.focus();
    showToast("Give the task a name first.");
    return;
  }

  const parsed = parseQuickAdd(source);
  const now = Date.now();
  documentState = withAddedTask(documentState, {
    title: parsed.title || source,
    notes: "",
    due: parsed.due,
    allDay: parsed.allDay,
    priority: parsed.priority ?? 1,
    tags: parsed.tags,
    color: null,
    reminder: parsed.reminder,
    timer: null,
    breaks: null,
    muteDuringSession: true,
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
  const title = sheetsRoot.querySelector("#edit-task-title")?.value.trim();
  if (!task || !title) return;
  task.title = title;
  task.notes = sheetsRoot.querySelector("#edit-task-notes")?.value.trim() || "";
  scheduleSave();
  closeSheet();
  rerender();
  showToast("Task saved");
}

function deleteTask(taskId) {
  const descendants = new Set([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of documentState.tasks) {
      if (task.parentId && descendants.has(task.parentId) && !descendants.has(task.id)) {
        descendants.add(task.id);
        changed = true;
      }
    }
  }
  documentState.tasks = documentState.tasks.filter((task) => !descendants.has(task.id));
  scheduleSave();
  closeSheet();
  rerender();
  showToast(descendants.size > 1 ? `Deleted task and ${descendants.size - 1} subtasks` : "Task deleted");
}

function toggleTask(taskId) {
  const task = documentState.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const wasDone = Boolean(task.completedAt);
  task.completedAt = wasDone ? null : Date.now();
  task.archived = !wasDone;
  scheduleSave();
  rerender();
  showToast(wasDone ? "Moved back to open tasks" : "Done", wasDone ? null : () => {
    task.completedAt = null;
    task.archived = false;
    scheduleSave();
    rerender();
  });
}

function selectTheme(themeId) {
  if (!themes[themeId]) return;
  documentState.settings.theme = themeId;
  selectedThemeFamily = themes[themeId].family;
  applyTheme(themeId);
  scheduleSave();
  rerender();
}

function updateParsedPreview(source) {
  const preview = sheetsRoot.querySelector("#parsed-preview");
  if (!preview) return;
  const parsed = parseQuickAdd(source);
  const chips = [];
  if (parsed.due) chips.push(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(parsed.allDay ? {} : { hour: "numeric", minute: "2-digit" }) }).format(parsed.due));
  if (parsed.reminder) chips.push(`every ${parsed.reminder.intervalMin >= 60 && parsed.reminder.intervalMin % 60 === 0 ? `${parsed.reminder.intervalMin / 60}h` : `${parsed.reminder.intervalMin}m`}`);
  if (parsed.priority === 2) chips.push("high priority");
  for (const tag of parsed.tags) chips.push(`#${tag}`);
  preview.innerHTML = chips.map((label) => `<span class="chip set">${escapeHtml(label)}</span>`).join("");
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
