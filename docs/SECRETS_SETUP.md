# Repository secrets

TaskFocus Android releases require four protected GitHub Actions repository secrets:

- `ANDROID_KEYSTORE_B64` — the permanent PKCS12 signing identity encoded as base64
- `ANDROID_KEYSTORE_PASSWORD` — the keystore password
- `ANDROID_KEY_ALIAS` — the signing-key alias
- `ANDROID_KEY_PASSWORD` — the private-key password

The Android release workflow reconstructs the two local signing files only inside its temporary runner and validates the certificate fingerprint before publishing. Never replace any of these values after installing the first APK. Never print the values in workflow logs.

## iPhone push relay

The Cloudflare deployment uses three additional Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard account ID
- `CLOUDFLARE_API_TOKEN` — token with Workers Scripts edit, D1 edit, and Workers Cron Triggers edit permissions
- `VAPID_PRIVATE_KEY` — the private half of TaskFocus's permanent Web Push identity

GitHub Pages reads one repository variable after the Worker is live:

- `TASKFOCUS_PUSH_WORKER_URL` — for example `https://taskfocus-push.example.workers.dev`

Phone path: repository → Settings → Secrets and variables → Actions. Use the **Secrets** tab and **New repository secret** for the three secrets. Use the **Variables** tab and **New repository variable** for the Worker URL. The public VAPID key is committed intentionally; the private key must never be committed or pasted into an issue.
