# TaskFocus build roadmap

## Phase 1 — delivery foundation

- Mobile application shell and approved theme tokens
- Capacitor Android project
- Permanent Android signing identity
- Unit and touch-browser test harnesses
- GitHub Pages deployment with build freshness checks
- Rolling signed APK release with visible build number

**Gate:** Pages opens successfully and the signed APK installs and launches.

## Phase 2 — data and task CRUD

- Versioned local document, migrations, backup copy, and import/export validation
- Task list, editor sheets, dates, priorities, colors, tags, and notes
- Single-task completion animation and Done section

**Gate:** complete task CRUD works on a phone with no console errors.

## Phase 3 — hierarchy and gestures

- Arbitrarily nested subtasks and progress
- Tree animation and connector lines
- Swipe-right add-subtask, swipe-left delete, hold-swipe collapse
- Cascading completion, automatic archive, Undo, and Clear all

## Phase 4 — intelligence and planning

- Natural-language quick-add parser
- Deterministic daily focus selection
- Category/tag filters
- Calendar

## Phase 5 — time and native notifications

- Timing wheels, interval reminders, exact due alerts, and quiet hours
- Work/break focus sessions
- Android notification actions and idempotent reconciliation

## Phase 6 — iPhone background push

- Installable PWA polish and Web Push client
- Cloudflare Worker, D1 schedule, VAPID, and `/status` diagnostics
- RFC 8291 `aes128gcm` verification

**Gate:** a push reaches a real iPhone with the home-screen app closed.

## Phase 7 — finish and harden

- Eight complete theme presets and accessibility checks
- Backup/restore, settings polish, update notices, and battery guidance
- Full automated and on-device regression pass
