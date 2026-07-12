# TaskFocus final implementation handoff

This is the permanent system map for a low-consumption verification agent. The owner works only from an Android phone. Do not ask the owner to run commands, use a terminal, install a toolchain, or visit localhost. GitHub Actions is the build machine.

## Delivery endpoints

- Android rolling APK: `https://github.com/icyhotpockets/TaskFocus/releases/download/latest/taskfocus.apk`
- Android rolling release: `https://github.com/icyhotpockets/TaskFocus/releases/tag/latest`
- iPhone/PWA: `https://icyhotpockets.github.io/TaskFocus/`
- iPhone push diagnostics: `<TASKFOCUS_PUSH_WORKER_URL>/status` after Cloudflare activation

The APK must always be installed over the existing app. Never advise uninstalling unless the owner has exported a backup; browser local storage is the database.

## Architecture map

### Shared application

- `www/index.html` — application shell, three-tab navigation, FAB, PWA metadata, sheet and toast roots.
- `www/styles/app.css` — complete token-driven design system, all eight themes, sheets, task tree, gestures, timing wheels, completion animation, safe areas, and reduced-motion behavior.
- `www/js/app.js` — DOM rendering and interaction coordinator: routing, task sections/tree, editor, filters, calendar, settings, gestures, completion sequence, persistence calls, sessions, and notification UI.
- `www/js/native.js` — the only Capacitor/platform detection boundary.
- `www/js/notifications.js` — Android LocalNotifications bridge, exact channel/actions, reconciliation, and two-minute test.
- `www/js/webpush.js` — iPhone permission/subscription flow, device UUID, full schedule replacement, and push test. Notification permission is requested before the function's first `await`.
- `www/sw.js` — push display and notification click handling only. It intentionally has no fetch cache.
- `www/push-config.json` — development/default push configuration. Pages replaces it from the repository Worker URL variable during staging.

### Pure application core

- `www/js/core/data.js` — versioned document, defaults, migrations, validation, import/export, monotonic IDs.
- `www/js/core/model.js` — children/ancestors/descendants, progress, completion cascade, archive, delete, clear, Undo restoration.
- `www/js/core/parser.js` — natural-language quick-add parsing and removable parsed-token behavior.
- `www/js/core/focus.js` — deterministic focus score/picks and date grouping.
- `www/js/core/filters.js` — category/tag normalization and OR-within/AND-between matching.
- `www/js/core/time.js` — local-day and quiet-hours math.
- `www/js/core/notifications.js` — pure interval, due, session, ID, limits, quiet-hours, and expiration planning.
- `www/js/core/themes.js` and `www/js/themes.js` — exact palettes, theme metadata, CSS application, and contrast-tested tokens.

### Persistence and updates

- Primary key: `taskfocus.data.v1`; backup key: `taskfocus.data.v1.bak`.
- Saves are debounced about 250 ms and write the previous primary value to the backup first.
- `scripts/stage-web.mjs` stamps `version.json` and `push-config.json` into the Pages artifact.
- `www/js/update.js` checks Android's installed build against the published build.
- `www/js/app.js` checks `version.json` on web startup/foreground and reloads once when the deployed commit changes.

### Android delivery

- `android/` — Capacitor 7 wrapper. Keep the permanent signing identity unchanged.
- `.github/workflows/android.yml` — checks out the exact successful CI commit, stamps the CI run number, restores signing secrets, builds/verifies the APK, moves the `latest` tag, and replaces the rolling release asset.
- Android reminders reconcile on launch, resume, and data changes. Interval actions are Done/Snooze 1h; due actions are Done.

### iPhone background push

- `worker/src/index.js` — CORS API, subscription upsert, idempotent schedule replacement, unsubscribe, test, public redacted status, one-minute send loop, invalid-subscription purge, and bounded diagnostic log.
- `worker/src/webpush.js` — VAPID JWT and RFC 8291 `aes128gcm` implementation using Web Crypto.
- `worker/schema.sql` — D1 subscriptions, encrypted pending payloads, fire-time index, and diagnostic ring log.
- Pending task title/body/url are encrypted at rest with an AES-GCM key derived from the Worker-only VAPID private key. `/status` exposes counts, fire times, and result codes, never task text.
- `worker/tests/aes128gcm.test.js` — receiver-side round trip proving the generated request decrypts correctly and uses a big-endian 4096 record size.
- `.github/workflows/worker.yml` — idempotently creates/locates D1, applies schema, uploads the private VAPID key, deploys the Worker/cron, and curls `/status`. It exits successfully with a notice when Cloudflare secrets are absent so Android/Pages are never blocked.

## Completed product behavior

- Tasks, Calendar, and Settings hash routes with scroll/disclosure preservation and 30-second live refresh.
- Natural-language capture for dates, times, intervals, priority, and tags with individually removable parsed chips.
- Full task editor: date/time, timing, priority, eight category colors, tags, notes, Delete, and Add subtask.
- Arbitrarily deep task tree, progress chips, connector lines, animated collapse, parent labels for flat matches.
- Swipe right add-subtask; swipe left parked trash; single revealed card; subtree delete confirmation; 500 ms hold/down-swipe collapse.
- Twelve-bubble completion, check fill/pop, descendant cascade, auto-archive, Undo, Done tree, confirmed Clear all.
- Deterministic focus list, date sections, category/tag filtering, and calendar cards.
- Scroll-snap hour/minute wheels whose values live in `dataset.val`; hidden/reopened panels restore from draft state; custom drags suspend mandatory snap.
- Interval nags, due alerts, focus-session boundaries, quiet hours, Android actions, and two-minute tests.
- Eight exact themes with live family/variant picker and persisted WCAG-tested tokens.
- Full JSON backup/restore and last-known-good corruption fallback.
- PWA manifest/icons/safe areas, stale-client reload, Android update toast, and visible version/build.

## External activation still requiring owner credentials

Application code is complete, but background iPhone delivery cannot become live until the owner's Cloudflare account authorizes deployment. Required GitHub Actions secrets are documented in `docs/SECRETS_SETUP.md`:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `VAPID_PRIVATE_KEY`

After the Worker deploys, add its URL as repository variable `TASKFOCUS_PUSH_WORKER_URL`, then rerun the normal Pages deployment. The public VAPID key is already fixed in the source and must stay paired with the generated private key.

## Verification-agent boundaries

- Start with `docs/VERIFICATION_CHECKLIST.md` and report evidence against it.
- Verify before editing. Do not restyle, reinterpret, or replace the architecture.
- If a device feature appears broken, confirm the installed build/version first. For iPhone push, inspect `/status` before changing code.
- On-device notification arrival is the final owner's test; browser automation cannot prove lock-screen delivery.
