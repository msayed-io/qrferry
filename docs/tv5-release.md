# TV-RECEIVE-5 — shared visual identity and three-file batches

Predecessor: `5d9ea02` (TV-RECEIVE-4).

## Visual identity, not another layout rewrite

The TV receiver now uses QRFerry's existing `--paper`, `--ink`, `--white`, `--line`, `--signal`, `--signal-soft`, `--blue` and `--muted` tokens. Its four-square brand mark, paper grid, near-square panels, hard-offset ink shadows and signal-colored primary actions follow the sender's visual language. The TV's overscan padding, large controls, status rail, library/settings panels and spatial remote navigation remain.

Removed the obsolete TV-only rules from `app/globals.css`; `app/tv/tv.css` owns the receiver's styling. The legacy rules had left light-on-dark text colors on instructions/library status and a blurred QR shadow even after changing the newer palette. Screenshot inspection caught these inherited rules; browser assertions now check text contrast colors as well as the page/panel colors and the QR canvas shadow.

Three received files use one row of numbered, focusable buttons. Long names truncate in the selector, while the selected file's heading and the selector's accessible text/title retain the name. Compact-height screens keep primary playback/download controls visible. Older received bundles with more entries are still supported; the new selection limit is not a protocol or storage migration.

## Sender: explicit batch editing

- The native input already supported multiple files. It now clearly explains the maximum of **three files per batch**.
- Users can choose two/three together, or use **Add a file to this batch** after selecting the first one. This reuses the native file chooser and appends rather than replacing.
- Each selected file has a remove button. The counter shows selected / maximum; Add disables at three. Change/Browse still replaces the selection deliberately.
- File/folder selection and drag/drop respect the same maximum. A selection exceeding count or the existing total byte limit is rejected as a whole, with a visible message; existing files are retained, never silently truncated. Shared-file pickup also checks these bounds.
- Cached bytes are reused for retained files when adding/removing. Changing a batch invalidates the previous optical transfer and pending encoding generation. Removing the last file disables both send paths. Busy or active transfer-modal selections are not allowed to replace the batch.
- The existing package/transport implementation sends one batch and the TV extracts its individual files. Playback, library persistence, browser download requests and optional picker behavior remain separate as in TV-RECEIVE-4.

## Verification

- Lint, TypeScript, both production builds, 52 unit cases (including five new selection-policy tests) and two SSR cases passed.
- Full browser suite: **66/66 passed on production Next and 66/66 on production vinext**.
- Browser coverage includes native multiple selection, incremental addition on a phone viewport, removal/replacement, over-limit rejection without mutation, drag/drop bounds, English labels, clearing old optical payloads, a single-session three-file transfer, exact individual downloads, persistent reopening, and automatic download requests for all three files.
- All five receiver/remote layout cases now receive **three files**, including a long Arabic filename: 960×540, 1280×720, 1920×1080, 3840×2160 and 800×600. Assertions also verify shared brand colors, readable inherited text, the original four-square mark and no page-wide horizontal overflow.
- Separate production Google Chrome 153 probe: **three generated AAC-LC M4A files**, each 23,391,537 bytes; 70,174,611 bytes total. One batch completed in 11,425 ms on the local test network. Each file played with advancing time and matched its source SHA-256. All three were then reopened from the persisted library after page reload and again matched/played. TV production test mode was disabled. This timing is not a promised speed on another network.

No transport/handshake changes, IndexedDB schema changes, stored-file clearing, media conversion, or claim of testing the user's unavailable original recording or physical LG television.
