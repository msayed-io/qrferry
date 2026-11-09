# Android implementation and release gates

## Packaged application

React 19 + Vite builds `dist/`; the complete output is copied to `www/`, then packaged by Capacitor 8.6.0. There is no `server.url` and no remote-website dependency for the application UI or optical transport. Package: `com.msayed.qrferry`; min SDK 24; compile/target SDK 36; build JDK 21. A current compatible Android System WebView is required; minSdk alone does not establish support for old WebView JavaScript engines.

`MainActivity` registers the local `QRFerryDevicePlugin` before bridge creation. This adapter uses existing Capacitor/Android dependencies, not a new runtime plugin package:

- Actual Android `Configuration` locales/night mode, initial read and configuration/resume events. React awaits the initial native read before mounting.
- `ACTION_SEND` / `ACTION_SEND_MULTIPLE` with temporary content-URI permissions, bounded sequential reads and file-count/total-size checks. No broad storage permission or arbitrary path access from JavaScript.
- User-selected `ACTION_CREATE_DOCUMENT` destinations and bounded native save chunks. Cancellation is not reported as a saved file. Web downloads remain browser downloads.
- Native notification permission/channel, and reference-counted screen-awake ownership with pause/resume behavior.

The QR/RaptorQ worker is identical on web and Android. Camera generation tokens discard late permission results and worker responses after cancel/navigation. Worker failures are visible/retryable, not a silent return to main-thread decoding.

Android backup is disabled to avoid automatically backing up locally stored private identity material. This does not retroactively erase earlier system backups, migrate keys into Android Keystore, or provide a hardware-backed key guarantee. The existing identity/resume/history/library schemas are retained.

## Release pipeline

A push to `main` (except the bot's `[skip android release]` commit) runs:

1. Clean dependency install, lint, TypeScript, protocol/unit tests, production build, and browser release tests.
2. Prepare the next patch and monotonically increment `versionCode` **only in the CI working tree**.
3. Build/sync the complete local web output and compile Android/unit/instrumented tests.
4. Run API 35 Emulator tests using an actual WebView: real QR pixels → ZXing worker → RaptorQ recovery, ArrayBuffer ownership transfer, live Android OS language/night-mode changes, and real content-URI share chunks at nonzero offsets. Test fixtures and JavaScript test bridges live only in `androidTest`, not the release app.
5. Build signed APK and AAB with the existing `android-release` environment secrets.
6. Verify package/version/code, local worker assets, absence of a remote `server.url`, APK signatures via **apksigner**, and archive integrity.
7. Only after those checks: atomically push the version commit and tag. A failed build/test does not consume another release number.
8. Upload both assets to a draft GitHub Release, then publish it. A rerun after upload failure recognizes the already-created matching tag rather than creating another version.

Do **not** manually bump `package.json` before the normal main push. Starting from 1.2.8, this pipeline targets **1.2.9 / versionCode 10209**. The version code is previousCode+1; it no longer collides when patch reaches 100.

Required environment secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Keep the same signing key for upgrades. Keystore material is written only to the runner's temporary directory and removed in an always-running cleanup step. Credentials must not be embedded in remote URLs, source files, logs, APK assets, or documentation.

## Validation boundaries

A configured gate is not proof it passed. Check the specific run's quality job, emulator tests, signature verification, final tag, published assets and latest web deployment. Browser camera fixtures do not qualify a physical camera. API 35 Emulator tests do not qualify all API 24+ devices or OEM WebViews, document providers, notification settings, camera autofocus/torch, or background delivery.

Before wider distribution, test on a real target phone: first launch offline, system theme/language changes while foreground/background, actual screen-to-camera transfer including password and signature flows, cancelled permission requests, SAF save/cancel, sharing from another app, system Back, notification refusal/grant, wake-lock release and network changes. Insecure local WS signaling remains blocked on Android; use trusted WSS rather than enabling global cleartext.

## v1.2.10 system chrome, launcher and motion

- Status/gesture bars remain visible. `SystemChrome` is the sole native inset owner; Capacitor SystemBars inset handling is disabled (its OS-default icon styling remains). System/cutout/IME insets are applied once to the decor and consumed before the WebView. Native canvas and system-bar gutters match `#F7F4F6` / `#121014`; icon contrast follows Android night mode. API 24/25 retain a dark navigation-bar base because those versions cannot draw dark navigation icons. Native pages use the solid base rather than the web's subtle top glow, avoiding a seam.
- Adaptive normal and round launchers now reference the same transparent brand vector. API 33+ has a monochrome layer; legacy rasters are regenerated from the existing PWA mark. `node scripts/build-android-icons.mjs` regenerates resources; no new logo is invented. Splash uses that same adaptive icon and night-aware background. Launcher cache behavior still needs the user's device check.
- Glisse 0.5.0 remains the actual component/optics/spring implementation. A strict, idempotent `postinstall` patch coalesces two segment spring paints in the same-frame microtask, retains unchanged CSS mask properties, moves geometry reads ahead of filter writes, and skips generation of unused SVG backdrop graphs. Lens maps, foreground refraction, input semantics and spring constants are unchanged. The patch fails on an unexpected upstream version/source rather than silently applying a partial change.
- Only whole-page entrance translation is removed; control and message animation remain. Re-selecting the current navigation tab no longer resets scroll. The fixed navigation control owns its touch gesture; normal page/segmented-control scrolling remains.
- Native tests validate real status-strip pixels in light/dark, icon appearance, exact single status inset, adaptive/monochrome brand resources, in addition to existing worker/preferences/share tests. Emulator validation is not OEM/hardware certification.
