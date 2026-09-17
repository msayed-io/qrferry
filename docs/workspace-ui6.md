# QRFERRY-UI-6 — sender and scanner workspaces

Predecessor: `0e7ecdc` (TV-RECEIVE-5). The TV receiver keeps its existing version and design; this release applies its visual language to `/` and `/scan`.

## Design and content

- Shared `WorkspaceHeader`, `WorkspaceDisclosure` and `WorkspaceDialog`, with route-scoped `workspace.css`. Other routes retain `AppHeader`; TV styling and storage are unchanged.
- Reuse the paper/ink/signal/blue tokens, grid-paper background, four-square brand, nearly square cards, hard offset shadows and clear focus outlines.
- Replace the marketing hero with a compact title and one instruction. Remove the trust-chip row, long how-it-works section, repeated scanner tips and automatic first-visit tour from these pages. Required size limits, pairing instructions, password/trust prompts, errors and burn notices remain.
- Put fast transfer directly after the selected files. Hide the empty picker once files are selected and remove the redundant disabled “batch full” action. Change/add/remove remain available as applicable, native inputs stay mounted across tab changes, and the whole file card accepts drops. Three-file selection/add/remove remains unchanged. Keep the optical preview, start/pause and copy-link controls accessible as the alternative transfer method.
- Group privacy options, QR presets and technical counters into labeled expandable sections. The children stay mounted, so expanding/collapsing does not reset input values or recreate canvases. Actual status/progress stays visible; technical values remain real, not placeholder diagnostics.
- Scanner: separate camera/action and status/results cards; move start/stop directly under the preview. On completion, prioritize downloadable files rather than an inactive camera preview. Hide the now-irrelevant hold-steady tip and place rate/file counters inside the technical disclosure, keeping the first file download within the tested phone viewport. On narrow screens, password/trust review and camera errors move ahead of the camera card.
- Compact file-download links keep the full filename in their accessible label. Individual downloads, ZIP downloads, trust decisions, decryption and retry flows remain available.

## Interaction fixes accompanying the layout

- Modals fit phone portrait/landscape viewports, scroll internally, trap Tab focus, close with Escape or a visible close button, and return focus to the opener.
- Background sender shortcuts no longer activate while a dialog is open or while a button/link is handling its own keypress.
- Stopping fast pairing-camera scanning returns to its start screen instead of leaving the stopped preview as the only screen.
- Camera failures have a visible retry action using the existing camera startup path.
- Guard against legacy CSS leakage: QR stream state and progress text now explicitly use ink on paper. Split shared button selectors so the default white-button rule cannot override the signal-colored fast action through `:is()` specificity.

## Verification coverage

Seven viewports on each route: 320×568, 390×844, 768×1024, 844×390, 1280×720, 1920×1080 and 3840×2160. Cases check overflow, original brand colors, readable status text, primary-control visibility, three-file editing and touch targets. Additional cases cover disclosures/input retention, modal keyboard behavior and focus restoration, camera denial/retry, camera mode controls, stopping fast scanning, mobile multi-file downloads/restart, English layout and enlarged base text.

The prior transport/audio/persistence, encrypted optical recovery, signature/trust, burn notice, resumable scanning, three-file and TV-remote regressions remain in the full suite. The camera fixtures exercise real decoding using a deterministic simulated feed; they are not a physical-camera or LG hardware certification.

No wire-format, signaling/handshake, codec conversion, IndexedDB schema, existing-file deletion or save/download implementation changes.

## Release validation

- ESLint and TypeScript: pass.
- Unit tests: 52/52; rendered HTML checks: 2/2.
- Next production build: pass; complete browser suite in bundled Chromium: 89/89 (2.4 minutes).
- vinext production build: pass; complete browser suite in official Chrome: 89/89 (4.5 minutes).
- Responsive/interaction suite: 23 cases, included above. Includes a real native file-chooser event after switching to the text tab, three-file queue controls, and first-download visibility after completion.
- Screenshots reviewed from Chrome for phone and desktop: initial/selected files, pairing dialog, scanner idle and completed multi-file recovery. Seven-viewport assertions also cover short landscape and 4K. Enlarged-base-text checks do not constitute a native browser zoom or WCAG certification.

An initial vinext run timed out in an existing TV auto-download/library test after downloads had returned exact bytes (59 prior cases passed). It also had a signaling-server port conflict because a prior local server was still running. No cause for the browser timeout is established, and the port conflict is not presented as a proven cause. With a clean test-server lifecycle, the exact same three-file auto-download test passed 10/10 repeated runs without changing production logic or relaxing assertions. This is not evidence that the user's physical LG incident has been reproduced or cured.

A further traced bundled-Chromium run stalled on the receiver's first `page.evaluate` after an automatic-download event, while the sender reported completion. The trace is retained in the local QA evidence. The full official-Chrome run above passed all cases, including this case and three-file automatic download/persistence. The intermittent bundled-browser stall remains an observed QA limitation, not a claimed application fix.

## Publication

Changes are prepared on the existing repository's `main` branch. Publication requires restoring GitHub write authentication in the current workspace; the previous credential is not present. No deployment is claimed by this report.
