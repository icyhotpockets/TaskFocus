# TaskFocus product specification

This file is the durable reference for the approved build. Direct owner instructions override it. The product name is **TaskFocus**.

## Product and delivery

TaskFocus is a fast, attractive, offline-first task manager for an Android owner and an iPhone user. One framework-free `www/` codebase is wrapped by Capacitor 7 for Android and deployed unchanged as an installable iPhone PWA. It provides natural-language capture, nested subtasks, daily focus selection, recurring reminders, due alerts, focus sessions, calendar planning, filtering, touch gestures, completion animation, and eight themes. There are no accounts or analytics; task data stays on-device.

The owner works only from a phone. GitHub Actions must build, test, deploy, and release every artifact. Never ask the owner to run commands, use localhost, install a toolchain, or open an IDE.

- Android: a permanently signed `taskfocus.apk` replaces the previous installed build without clearing local data. The rolling `latest` GitHub release exposes a stable asset path and a build-number title.
- iPhone: GitHub Pages serves the same `www/` directory. Safari → Share → Add to Home Screen installs the PWA. Web Push works only from the installed home-screen app on supported iOS.
- Before requesting phone testing, unit tests, touch E2E, CI, artifact signing, and live endpoints must be verified.

## Architecture

- Plain HTML, CSS, and JavaScript ES modules. No framework, bundler, or web runtime npm dependency.
- Pure model, parser, filtering, scoring, time, and planning code stays separate from DOM code.
- `native.js` is the sole owner of Capacitor detection and platform gating.
- Hash routing has Tasks, Calendar, and Settings tabs, a fixed safe-area-aware tab bar, an accent FAB, and separate sheet/toast roots.
- A 30-second live rerender pauses while a sheet is open and preserves scroll/open disclosures.
- PWA paths are relative so the app works beneath the GitHub Pages repository subpath.
- The service worker handles push only; it must not add a fetch cache.
- `version.json` is stamped in CI. Web checks it on boot and foregrounding; Android compares its build number with the published build.

## Data

The database is one versioned JSON document stored at `taskfocus.data.v1`, with `taskfocus.data.v1.bak` written before each debounced overwrite. Loading migrates/backfills defaults. Import validates before replacement; export contains the whole document.

```js
task = {
  id, title, notes,
  due, allDay,
  priority, tags, color,
  reminder, timer, breaks, muteDuringSession, session,
  parentId, collapsed, archived,
  createdAt, completedAt,
}

settings = {
  quietStart: '22:00',
  quietEnd: '08:00',
  focusLimit: 5,
  theme: 'ember',
}
```

Task IDs are positive monotonic integers. Priority is `0` low, `1` normal, `2` high. Model operations include children, descendants, descendant progress, whole-subtree archive/delete, cascade completion with exact Undo state, and import/export.

## Design system

- Inter with `system-ui` fallback.
- Page/card/nested background ladder; card radius 16px, small radius 10px; 1px borders; shadows reserved for sheets and FAB.
- Mobile-first typography: page titles 1.65rem/700; body about 0.95–0.98rem; section labels 0.78rem uppercase; chip text 0.72rem/600.
- Every color is a CSS property. Components never hardcode color.
- Default Midnight Ember tokens:

```css
--bg:#1b2026; --bg-elev:#242b33; --bg-elev-2:#2e3742;
--text:#e8eaed; --text-dim:#97a3b0; --text-faint:#64707d;
--accent:#a63446; --accent-bright:#c4576a; --accent-deep:#7c2434;
--accent-soft:rgba(166,52,70,.18);
--good:#3ecf8e; --warn:#f39c12; --danger:#ff6b5e;
--border:rgba(255,255,255,.07); --tree-line:rgba(255,255,255,.16);
--shadow:0 8px 24px rgba(0,0,0,.35);
--accent-shadow:rgba(166,52,70,.45);
```

- Body prevents selection and Safari touch callout; inputs restore selection. Controls use `touch-action: manipulation`. Focused inputs keep an accent ring until blur.
- Chips are the signature metadata/filter/picker element. Variants cover due, overdue, nag, progress, priority, category, and active filters.
- Category colors are independent of the active theme: rose `#C4576A`, ember `#D96C47`, amber `#D9A441`, moss `#7FA65A`, teal `#4A9E8F`, steel `#5B84A8`, violet `#8A6FB8`, slate `#8B97A3`.
- Motion honors a global `--anim` multiplier and `prefers-reduced-motion`.

## Themes

Every preset defines the full token set and passes WCAG contrast tests. Light cards use warm shell/manila surfaces, never pure white.

| Family | ID | Name | Surface ladder | Accent triplet |
|---|---|---|---|---|
| Ember | ember | Midnight Ember | `#1b2026/#242b33/#2e3742` | `#a63446/#c4576a/#7c2434` |
| Ember | wine | Charcoal Wine | `#171419/#211d25/#2c2731` | `#94405f/#b76282/#6a2a43` |
| Deep Focus | cobalt | Night Cobalt | `#101722/#18222f/#212e3f` | `#3d72ad/#6296cd/#2a527e` |
| Deep Focus | paper | Paper & Ink | `#f0ead8/#fdf6e3/#f5efdc` | `#33557e/#466992/#24405e` |
| Calm | forest | Still Forest | `#151b17/#1d2620/#27332b` | `#4e8465/#6faa89/#375f49` |
| Calm | eucalyptus | Eucalyptus | `#ebeddb/#fbf7e6/#f2f1de` | `#3d7a5c/#548f70/#2b5741` |
| Energy | coral | Coral Drive | `#1c1613/#27201b/#332a23` | `#c25a38/#e07e5b/#8d3f25` |
| Energy | sunrise | Sunrise | `#f1e7cf/#fcf4df/#f4ebd3` | `#b35317/#cd6e33/#833c0f` |

Family blurbs: Ember “Warmth with focus — the original”; Deep Focus “Blues that support sustained attention”; Calm “Restorative greens, easy on the eyes”; Energy “Warm tones that lift alertness”.

## Tasks screen

- Header: time-of-day greeting and `weekday, date · N open · N done today`.
- Two filter chips only: Category and Tags. OR within each kind, AND across kinds. Active filtering shows flat matches with parent labels.
- “Your focus” always includes every overdue and due-today task, then fills to 3/5/7 by deterministic score: overdue `100 + hours` (cap 48), today `+80`, tomorrow `+55`, within 3 days `+35`, within 7 days `+15`, priority `×15`, staleness `+1.5/day` (cap 21 days), reminder `+10`.
- Remaining groups: Overdue, Today, Upcoming, Someday. Completed tasks retain their due group while their animation runs, then archive.
- Arbitrarily nested tree uses 34px indentation, rounded elbow connectors, 280ms collapse/reveal, and descendant progress chips.
- Done is a disclosure of archived roots, newest first, rendered to about 30, with confirmed Clear all.
- Empty state: “All clear. Tap + to capture your first task.” plus an example quick-add string.

Task card order is check circle, content, trailing session/chevron control. Metadata order is category, due, session/timer, priority, interval. Tap edits. Swipe right over 90px adds a subtask. Swipe left parks at −84px and reveals a 46px danger delete control; leaf deletion is immediate, subtree deletion confirms. A 500ms hold plus downward swipe over 40px toggles collapse. Only one card may remain revealed.

## Completion animation

Completion is a signature sequence: 12 accent bubbles converge, radial fill grows over 260ms, white check springs in over 240ms, then visible descendants cascade every 90ms top-to-bottom. Data flips across the subtree, it archives, and a `Done (+N subtasks)` toast offers Undo. Uncheck reverses the check/fill and bursts bubbles outward. Hidden descendants update data without animation.

## Editor sheets and quick-add

Sheets have a scrim, grabber, close control, and drag-down dismissal over 110px. Dismiss dragging must ignore starts on interactive controls. Toolbar taps support touchend with slop/ghost-click protection for iOS keyboard dismissal.

Quick-add parses weekday names, today/tomorrow, month/day, 12/24-hour times, `every 30m`, `every 2h`, high/low priority, and `#tags`. Past bare times roll to tomorrow. Parsed chips are removable; removed/manually overridden types enter a cleared set so parsing no longer overwrites them.

The accordion toolbar has Date, Timing, Priority, Color, Tags, and Notes. Date/time inputs call `showPicker()` and blur after changes. Timing enables interval (default 30m), timer (30m), breaks (25/5), and “silence intervals during session”. Scroll-snap wheels keep truth in `dataset.val`, restore visuals after hidden panels, and suspend snap during custom drags.

## Calendar and Settings

Calendar is a Sunday-first month grid with dots on open-task days, selected-day cards, month arrows, and Today jump. State survives tab changes.

Settings contains:

- Notifications: platform, permission, exact-alarm state, quiet hours, test in two minutes, and iPhone sound guidance.
- Appearance: family and variant previews with instant persistence.
- Focus: 3/5/7 size.
- Backup: validated JSON export/import with replacement confirmation.
- About: version/build and Android battery-optimization guidance.

## Sessions and notifications

Timer/break tasks expose Play/Stop. Session end and work/break boundaries are computed from `startedAt`, not stored. A finished session expires during reconciliation. Interval nags may be muted during that task’s session.

Notification planners remain pure. Platform glue consumes their rows.

- Interval anchor: `reminder.startAt ?? createdAt`, never due date. Plan about 12 hours, at most 24 per task and 180 total, earliest first, excluding quiet hours.
- Due alert: exact due time, or 09:00 local for all-day tasks; never quiet-hour filtered.
- Session events: Break time, Back to work, and Time’s up.
- IDs: `taskId*100 + slot`; nag slots 0–23, due 70, session 80–99, test 999001.
- Reconcile cancels all pending rows and schedules current truth. It is idempotent and runs on launch, resume, and debounced data changes.
- Android uses Capacitor LocalNotifications with exact/idle alarms and Done/Snooze 1h actions.

## iPhone push backend

Background reminders require Web Push from an installed iOS 16.4+ home-screen PWA. Notification permission must be requested synchronously inside the user tap before any intervening await. The client keeps a device UUID, posts its subscription, and replaces its complete schedule.

Cloudflare Worker + D1 stores subscriptions, pending rows, and a diagnostic ring log. Routes: `/subscribe`, `/sync`, `/unsubscribe`, `/test`, and public no-secret `/status`. A one-minute cron sends due rows and purges invalid subscriptions. Apple delivery must use RFC 8291 `aes128gcm`; legacy `aesgcm` silently fails. Cover encryption with a round-trip test.

## Verification and known traps

- Node unit tests cover parser, scoring, filters, task-tree operations, migrations, themes/contrast, quiet hours, and all planners with frozen time.
- Touch E2E uses Playwright at 412×915, persists seeded data only after the save debounce, checks routes/filters/gestures/completion/themes/editor, mocks Web Push, and fails on console errors.
- Before device diagnosis, verify that the installed client is current and inspect the Worker `/status` log.
- Never regenerate the Android key. Never advise uninstalling without export; local storage is the database.
- Avoid iOS sheet-drag tap theft, keyboard click loss, date-picker non-opening, wheel snap re-quantization, hidden-wheel position loss, long-press text selection, stale PWA/APK code, debounced-save reload races, mid-animation regrouping, and periodic rerender scroll reset.
