# Tap selection, measured segments and floating chrome

## Scope and invariants

The user confirmed the v1.2.11 held lens is now working on their phone. This change does **not** replace its drag handlers, refraction maps, physical rim, or drag springs. The upstream `onPointerDown`, `onPointerMove`, `onPointerEnd`, `DRAG`, `LENS$2`, and `createSpring` bodies were compared byte-for-byte against Glisse 0.5.0 and retained.

An opted-in **short press on another navigation tab** now takes a separate selection path. It does not briefly start the lift spring and then reverse it. At 150ms of holding or >6px horizontal travel, the original gesture handler takes over. Pressing/dragging the already-selected lens still goes straight to the original handler. Short-tap settling tunes only the horizontal spring (420 stiffness / 41 damping); held/drag tuning remains unchanged. Keyboard selection and reduced motion remain native. Blur, visibility, cancellation and disposal clear pending tap timers. No route delay, fake result, or transport modification was added.

## Android segmented-control defect

The previous width `calc(100cqw / var(--lg-tabs))` is unsupported in WebView 91 (Android 12 emulator). Unsupported custom-property units invalidate dependent widths, leaving labels at content width while the controller measures equal physical slots.

A layout effect plus ResizeObserver now supplies the actual container width divided by the item count in CSS px. The original labels, tint labels, lensed labels and native selection use the **same** width. No flex-only workaround or duplicate visual selection. Tests cover widths 320/390/844, Arabic/English and native WebView. The Android test temporarily restores the old declaration, reproduces the bad width when `cqw` is unsupported, then restores the measured width.

## Floating chrome

- The menu trigger measures 40×40 CSS px. Support back controls use the same native Glisse Button and visual dimensions, with a 44×44 transparent hit area. Title capsules are 40px high with content-dependent width; they are not forced into a 40px-wide circle.
- History/Privacy: title physically left and back physically right in both languages. The custom rounded 2.4-unit chevron follows the user's reference; its color follows the theme.
- Main, support and chat headers are fixed to the viewport with safe-area offsets, transparent wrappers and no shared glass plate. Only the individual controls receive pointer events. The application brand is not in a capsule.
- Connected Chat hides the global header and bottom navigation, without unmounting the session owner. Its header has separate peer/status, disconnect and return-to-Pair controls. Return to Pair restores global chrome without disconnecting. Explicit disconnect keeps its existing meaning.
- Chat's three-control composer stays at the lower safe area, with its own bottom gradient. Other pages have no new bottom gradient. The Android window retains `adjustResize` for the keyboard.

## Progressive blur implementation and trade-off

Two independently masked backdrop passes, 6px and 22px, mix with the sharp underlying scene. This is a spatial approximation of variable blur, not a single fixed blur hidden under an opacity gradient, and not Apple's private variable-radius/material/vibrancy engine. Saturation is 1.15 per pass; theme-aware native materials and readable foreground colors are retained. No screen copy, canvas screenshot, animated blur radius, blend-mode contrast inversion or opaque rectangular toolbar plate.

The top field is `safe top + 88px`; the stronger pass occupies only 70% of that field. The bottom field exists only for the visible chat composer and is reversed toward the lower edge. Both fade to zero. Initial content spacing avoids blurring the first heading before scrolling.

An initial five-pass implementation was rejected after profiling software WebKit at roughly 1.4–1.5 seconds between scrolling frames. The two-pass version measured roughly 0.18–0.20 seconds in the same software-only profile and passed the unchanged WebKit navigation/tap assertions; Chromium delivered ~16.7ms intervals in the initial comparison. These are test-environment measurements, **not** hardware responsiveness claims or 60fps guarantees. A real phone trial remains important. Unsupported backdrop/mask engines use a theme-colored fading fallback. Reduced transparency explicitly disables both blur passes and retains a readable fading background; reduced motion remains respected by native spring code.

## Regression coverage

`e2e/navigation-tap.spec.ts`, `e2e/floating-chrome.spec.ts`, the existing held/diagonal lens test, route-continuity and rim suites, support-page coverage, and real-peer two-way chat/file tests cover the new paths. Android `FloatingChromeTest` covers old-unit reproduction, measured slots, viewport-fixed support controls and short taps with zero lift. Instrumentation-generated pointer events prove functional state, not physical input latency. No production debug hook or simulated connection was introduced.
