# Repository secrets

TaskFocus Android releases require four protected GitHub Actions repository secrets:

- `ANDROID_KEYSTORE_B64` — the permanent PKCS12 signing identity encoded as base64
- `ANDROID_KEYSTORE_PASSWORD` — the keystore password
- `ANDROID_KEY_ALIAS` — the signing-key alias
- `ANDROID_KEY_PASSWORD` — the private-key password

The Android release workflow reconstructs the two local signing files only inside its temporary runner and validates the certificate fingerprint before publishing. Never replace any of these values after installing the first APK. Never print the values in workflow logs.
