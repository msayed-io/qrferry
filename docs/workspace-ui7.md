# QRFERRY-UI-7 — complete the secondary-page redesign

The history, offline and privacy pages now use the same paper/ink/signal identity as the approved TV and sender/scanner workspaces. The TV page itself is unchanged.

## Navigation and layout

- Shared `SupportShell` with `WorkspaceHeader`, a prominent **الرجوع للرئيسية / Back to home** link and an active three-page subnavigation.
- The home action is a real link to `/`, not browser-history back, so it also works after opening a page directly, refreshing or following an external link.
- Responsive cards, consistent touch targets/focus outlines, original colors, squared corners and offset shadows. Desktop uses two columns; phones stack the content.
- Header release badge moves to `QRFERRY-UI-7`; existing sender/scanner layouts and TV-RECEIVE-5 remain intact.

## Page details

- History: readable cards replace the narrow seven-column table. All existing fields remain: name, size, count, time, encryption, signature and verification. Empty/loading states are explicit. Clearing requires confirmation via the shared keyboard-safe dialog; cancel/Escape returns focus. No automatic deletion or migration.
- Offline: clear package action and preparation state, actual ZIP generation preserved, success explicitly means “download requested”, inline retryable errors replace a blocking alert. Instructions retain the secure-context camera requirement and explain preparing server dependencies before disconnecting. This change does not certify complete standalone/air-gapped operation or rewrite the existing asset collector.
- Privacy: readable bilingual sections accurately distinguish optical transfer from WebRTC signaling, describe camera use beyond the scanner, and disclose history, resume data and actual received files in the TV library. Clarify that clearing history is separate from deleting downloads or library files.
- ESLint ignores generated Playwright reports/traces, not application source.

## Verification

- ESLint and TypeScript: passed.
- Unit tests: 52 passed; SSR tests: 5 passed (including all three new page shells).
- Next and vinext production builds: passed.
- Full Next production E2E suite: **112/112 passed** (2.9 minutes).
- New secondary-page suite on vinext: **23/23 passed** (16.4 seconds).
- Six viewports per page: 320×568, 390×844, 768×1024, 844×390, 1440×900 and 3840×2160. Tested actual home navigation, initial-fold home visibility, no horizontal overflow, colors, selected navigation and touch-target size.
- Additional tests verify seeded history display, long names, cancellation/focus, confirmed deletion surviving reload, real ZIP contents including the updated privacy HTML, injected fetch failure/retry, English/reload navigation and enlarged base text. Failure injection disables service workers so cached responses cannot bypass the simulated network error; assertions are scoped to the app, not Next's route announcer.
- Reviewed real browser screenshots on phone and desktop. Enlarged-base-text tests are not a native browser zoom or WCAG certification.

No transport, encryption protocol, playback/save implementation, offline package builder or IndexedDB schema changes.
