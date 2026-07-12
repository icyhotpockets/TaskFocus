# TaskFocus final verification checklist

This checklist is for a lower-consumption sanity-check agent. It is an evidence pass, not a redesign request. Read `docs/FINAL_HANDOFF.md` and `docs/PRODUCT_SPEC.md` first. Do not modify code unless a check demonstrates a real defect and the owner separately authorizes the fix.

## 1. Source integrity

Check:

- Working tree contains no unexplained changes.
- `node --check` succeeds for `www/js/app.js`, `www/js/webpush.js`, `www/js/notifications.js`, `scripts/e2e-smoke.mjs`, `worker/src/index.js`, and `worker/src/webpush.js`.
- `git diff --check` reports no whitespace errors.
- `www/sw.js` contains push/click handlers and no `fetch` event listener.
- `worker/src/index.js` never returns task title/body from `/status`; pending payloads are encrypted before D1 insertion.

Context: source integrity catches broken ES modules, accidental merge artifacts, and the privacy regression where public diagnostics could reveal task text.

## 2. Pure logic

Run the existing unit command once: `npm run test:unit`.

Expected coverage includes:

- Data migrations, backup keys, strict import validation, monotonic IDs.
- Arbitrary-depth tree helpers, subtree completion/archive/delete/Undo/Clear all.
- Parser, removable tokens, filters, focus scoring/groups.
- Quiet hours including midnight crossing, interval anchors/limits, due/session rows, stable notification IDs.
- Eight complete themes, exact approved colors, and WCAG contrast gates.

Do not repeatedly rerun a passing suite unless source changes afterward.

## 3. Web Push encryption and relay

From `worker/`, install pinned dependencies and run `npm test` once.

Expected:

- The RFC 8291 test creates a real receiver ECDH key, decrypts the request, finds delimiter byte `2`, and recovers the original JSON.
- Request header is `Content-Encoding: aes128gcm`.
- Record size parses as big-endian `4096`.

Inspect the relay:

- `/subscribe` validates and upserts one subscription per device UUID.
- `/sync` deletes that device's previous rows and inserts the current full plan.
- `/test` replaces sentinel ID `999001` at now + 2 minutes.
- Cron selects due rows, sends once, logs the HTTP code, deletes sent rows, and purges subscription/pending rows on 404/410.
- D1 stores encrypted `payload`, not plaintext title/body columns.

## 4. Mobile browser interaction pass

Use the repository's single Playwright command at 412×915 with touch enabled: `npm run test:e2e`.

The existing script must prove without console/page errors:

- Three tabs and FAB.
- Quick-add persistence and removable parsed chips.
- Category/tag live filter behavior.
- All editor toolbar chips and timing wheels.
- Focus-session Play/Stop.
- Add subtask by editor and swipe; tree progress/collapse; swipe-delete; cascade completion; Undo; Clear all.
- Calendar, themes, quiet hours, export/import, and corrupt-primary backup recovery.
- Mocked Android notification permission/channel/schedule/test/Snooze/Done.
- Mocked iPhone permission/subscription plus `/subscribe`, `/sync`, and `/test` requests.

If this fails, use the first concrete Playwright stack trace. Do not make broad UI changes from a selector-only failure.

## 5. GitHub delivery

For the final commit, confirm these workflows are green:

- `CI`: Unit tests, Mobile browser smoke test, Web Push encryption.
- `Deploy Pages`: staged artifact and Pages publication.
- `Release Android APK`: signed rolling APK.
- `Deploy iPhone Push Worker`: green deployment, or green skipped-with-notice when Cloudflare secrets have not yet been supplied.

Confirm live `version.json` reports the exact tested commit and CI run number. Download the stable APK and verify:

- File is recognized as an Android APK with a signing block.
- ZIP integrity succeeds.
- Embedded `assets/public/version.json` matches live Pages.
- Release title shows the same build number.

## 6. Live endpoint verification after Cloudflare activation

Check `<TASKFOCUS_PUSH_WORKER_URL>/status` with no credentials.

Expected JSON:

- `ok: true`
- numeric `subscriptions` and `pending`
- `next` containing only `fire_at` or null
- recent logs containing device prefixes/counts/HTTP codes but no task title or body

Confirm Pages `push-config.json` contains the exact Worker URL and fixed public VAPID key. If blank, set repository variable `TASKFOCUS_PUSH_WORKER_URL` and redeploy Pages; do not change the VAPID pair.

## 7. Owner device acceptance

Android:

1. Install the stable APK over the existing version and confirm the Settings build number.
2. Enable notifications and exact alarms; set TaskFocus battery mode to Unrestricted.
3. Tap the two-minute test, close the app, lock the phone, and expect `TaskFocus test`.
4. Create a task due five minutes out, close the app, and expect `Due now` with Done.
5. Create an interval task, expect the nag, test Snooze 1h, and confirm completing it removes future alarms.

iPhone after Cloudflare activation:

1. Open the Pages URL in Safari and use Share → Add to Home Screen.
2. Launch only from the installed icon, tap Enable, and allow notifications.
3. Tap the two-minute test, close the PWA, lock the phone, and expect the push.
4. If it does not arrive, confirm current Pages build and inspect `/status` sync/send HTTP codes before changing code.

## Final report format

Return:

- Commit/build verified.
- Each workflow conclusion.
- Unit/E2E/encryption result counts.
- Pages, APK, release, and Worker status evidence.
- Any failed item with the exact file/function or workflow step involved.
- Explicitly distinguish code-complete items from owner-account activation and physical lock-screen delivery.
