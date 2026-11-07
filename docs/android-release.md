# QRFerry Android release

The Android app is a Capacitor 8.6.0 shell around a React 19 + Vite static application. `npm run build` bundles the React entry point, CSS, WebAssembly modules, workers, fonts, icons, and other public assets into `www/`; Capacitor then packages that directory into the APK/AAB. There is no `server.url`, Vercel dependency, Next.js runtime, or remote web page in the Android application.

The native application ID is `com.msayed.qrferry`. The checked-in Android project targets SDK 36, uses Java 21 in CI, and uses the QRFerry maskable icon in the launcher resources.

## Android permissions

- `INTERNET`: loads the HTTPS application and supports the optional PeerJS/WebRTC signaling path.
- `CAMERA`: scans animated QR transfers and bridge pairing codes.
- `VIBRATE`: completion and incoming-transfer feedback.
- `WAKE_LOCK`: supports the web Wake Lock flow while a transfer is active.
- `POST_NOTIFICATIONS`: allows the app's optional completion/incoming notifications on Android 13+.

The app does not request microphone, contacts, location, storage, SMS, or phone permissions. File data remains in the web app's in-memory/object storage paths and IndexedDB; the app does not upload optical-transfer files to a QRFerry file server.

## Automated release

`.github/workflows/android-release.yml` runs automatically on every push to `main` and can also be started with `workflow_dispatch`. The first job increments the patch version, derives a monotonic Android `versionCode`, commits the update with `[skip android release]`, tags it as `vX.Y.Z`, and pushes both commit and tag. The second job checks out that exact SHA, runs `npm run build`, verifies the generated local assets, runs `npx cap sync android`, builds a signed release APK and AAB, uploads both as an artifact, and creates a GitHub Release with generated notes.

Release signing is isolated in the `android-release` Environment. The workflow expects these Environment secrets and never commits them:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The keystore is materialized only under the runner temporary directory and removed in an `always()` cleanup step. Pull-request workflows are not granted signing secrets because this repository intentionally uses a push-to-main release pipeline.
