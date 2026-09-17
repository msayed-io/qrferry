# TV-RECEIVE-4 — TV dashboard and bounded browser operations

Predecessor: `534b6b8` (TV-RECEIVE-3). No transfer protocol or IndexedDB schema changes.

## Confirmed issues addressed

- Preserve DOMException names such as `QuotaExceededError` when `.message` is empty. Generic exceptions, cross-realm error-shaped objects and unknown values are covered.
- Bound library open/list/read waits to 15 seconds and write/delete waits to 30 seconds. Abort a still-active transaction where possible. Late completion is not allowed to turn a timed-out UI into a false success; abandoned late DB opens are closed. A timeout means **not confirmed**, not proof that no bytes were written.
- Record actual library phases (open, write, request success, transaction completion, error/timeout), elapsed times and original error identifiers. Request success still does not count as a committed write.
- Bound the trust-key lookup for delivery to 5 seconds; unavailable trust storage defaults to no trusted keys, never to trusting unknown signatures. Signature verification remains unchanged.
- Separate a successfully committed file from a subsequent library-list refresh error. A refresh failure no longer incorrectly labels the completed write as failed.
- Observe real media `readyState`, `networkState`, current time and events. After 15 seconds without readiness/progress, show a warning and an explicit reload-player action. Bound pending `play()` promises. Do not call `play` itself evidence of actual playback: use `playing`/time progress. Recover warnings when real progress returns.
- Bound writes/closes in the optional save picker, not the time the user spends choosing a location. Automatic/direct download semantics remain request-only.

## TV layout

- Separate root state classes (`tv-state-ready`, etc.) from content classes (`tv-ready`). Previously the root's ready class could pick up the QR grid layout itself.
- TV-scoped stylesheet; other application routes are unchanged. Overscan padding, readable text, wrapping filenames, native media controls, large primary buttons and visible operation cards.
- Library and connection settings are separate toggleable panels. Technical event details and save options use normal buttons with expanded state, not native details widgets.
- Physical arrow navigation prefers targets in the same row/column. Hidden/disabled elements are excluded. Enter toggles the auto-download checkbox; Escape/TV Back closes panels and restores focus. Native text editing and media controls retain their keyboard handling.
- Version marker is visible in the header. Primary playback/download controls fit tested 960×540, 1280×720, 1920×1080 and 3840×2160 viewports; 800×600 uses a stacked layout. Secondary/expanded content can scroll rather than being clipped.

## Verification

- 47 unit tests, including deadlines, cleanup, late completion and empty error names.
- 58 browser E2E cases, including new lost-open/lost-commit/media-readiness/pending-play scenarios and five viewport/remote-navigation cases.
- TypeScript, lint, both production builds and the existing two SSR cases.
- Separate Google Chrome 153 investigation using generated, valid AAC-LC M4A files of exactly 23,391,537 bytes, with `moov` at either end. Three successive transfers, playback time progression, SHA-256 byte equality and library reopening verified. Real quota rejection via DevTools now exposes `QuotaExceededError`. Deliberately withholding the application's commit callback now exits the pending UI at its deadline while audio continues playing.
- The standard bundled Chromium Headless Shell does not support AAC here. The separate real-AAC verification was performed in Google Chrome, not inferred from WAV test success.

The browser fault-injection cases are deliberately controlled failures, not an emulation of LG firmware. A watchdog also requires a responsive JavaScript event loop; it cannot recover a completely frozen/crashed browser.

## Release safety

No stored-file deletion, new DB version, forced codec conversion, file-upload server, or handshake timing changes. Existing v2 records are preserved. The prior v3 build can read the same schema. Keep backups of important files: browser-origin storage still has quota/eviction limitations.

These changes fix the demonstrated error-reporting, waiting and layout defects. They do not certify that the original, unavailable M4A file will decode on the user's physical LG browser, or that that browser permits filesystem downloads.
