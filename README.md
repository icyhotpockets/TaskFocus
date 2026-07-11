# TaskFocus

TaskFocus is a private, offline-first task manager built for two delivery targets from one codebase:

- a signed Android APK for direct installation and in-place updates;
- an installable iPhone Progressive Web App served through GitHub Pages.

The application source is framework-free HTML, CSS, and JavaScript in `www/`. Capacitor wraps that same directory for Android. GitHub Actions is the only supported build and release path; the owner works entirely from a phone and is never expected to run a local toolchain.

## Delivery

- **Web/PWA:** GitHub Pages deployment from `www/`
- **Android:** rolling GitHub release with a stable `taskfocus.apk` asset
- **Tests:** Node unit tests and Playwright mobile-browser checks before release

### Install and test

- **iPhone/PWA:** <https://icyhotpockets.github.io/TaskFocus/>
- **Android APK:** <https://github.com/icyhotpockets/TaskFocus/releases/download/latest/taskfocus.apk>

The permanent Android signing identity is held in protected GitHub Actions secrets, never in repository files.

## Project status

Phase 1 establishes the application shell, persistent signing identity, automated builds, Pages delivery, update detection, and verification pipeline. Product behavior is added in small, tested increments following the repository guidance in `AGENTS.md`.

## Data ownership

Task data remains on the device. There are no user accounts or analytics. Before uninstalling the Android app or clearing browser data, export a backup from TaskFocus once that feature is available.
