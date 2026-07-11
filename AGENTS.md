# TaskFocus repository guidance

Read `docs/PRODUCT_SPEC.md` before product work and `docs/ROADMAP.md` before choosing a build stage.

## Product identity

- The product is **TaskFocus** (one word).
- Android application ID: `com.icyhotpockets.taskfocus`.
- Android release asset: `taskfocus.apk`.
- Do not reintroduce the former working name `Focus` in user-facing copy.

## Owner workflow

- The owner works entirely from a phone. Never ask them to run commands, use a terminal, install an IDE/toolchain, visit localhost, or build the project.
- All code, tests, builds, deployments, and diagnostics are agent/CI responsibilities.
- Ask for phone testing only after automated checks pass and the live artifact has been verified.
- Give any unavoidable account or secret setup as one phone-sized, tap-by-tap action at a time.

## Architecture

- `www/` is the source of truth: plain HTML/CSS/JavaScript ES modules, served verbatim.
- No web framework, bundler, transpiler, or runtime npm dependency.
- Keep pure domain logic separate from DOM code and cover it with `node --test`.
- Capacitor 7 wraps `www/` for Android. GitHub Pages serves the same directory as an iPhone PWA.
- A single native-platform module owns Capacitor detection and gates platform differences.
- Store data as one versioned JSON document with a last-known-good backup, migrations, and debounced persistence.

## Delivery invariants

- GitHub Actions is the only release path.
- Keep the Android signing key in the protected repository secrets and constant forever; replacing it breaks in-place updates and risks local data loss.
- Every push must run unit and mobile E2E checks before deploy/release jobs.
- Pages deployments include a no-cache `version.json` stamp. The PWA checks it on boot and when returning to the foreground.
- Android builds expose the workflow run number in Settings and use it as `versionCode`.
- The rolling release keeps a stable `latest` tag and `taskfocus.apk` filename.

## UI invariants

- Match the approved design; do not restyle it under the guise of improvement.
- Use CSS custom properties for every color. Midnight Ember is the default.
- Design mobile-first at 412 x 915 with iPhone safe-area support.
- Preserve scroll position and open disclosure state on periodic rerenders.
- Sheets must not let drag-to-dismiss steal taps from controls.
- Honor reduced-motion preferences.

## Verification

- Unit-test model operations, parser, focus scoring, filters, planners, quiet-hours math, migrations, themes, and contrast.
- Run Playwright with a touch-enabled 412 x 915 viewport and fail on console errors.
- Verify the deployed Pages URL and rolling release artifact before asking for on-device testing.
- On a reported device failure, verify the client build and deployment status before changing product logic.
