# Direct and automatic downloads — TV-RECEIVE-3

Follow-up to the verified TV-RECEIVE-2 repair. On a newly received, validated delivery, request direct browser downloads for each extracted file by default. Never invoke the filesystem picker automatically. The primary **Download file** action uses the same direct path; the old picker remains an explicitly optional action under **Additional save options**.

- A persisted checkbox enables/disables automatic requests, defaulting on when no preference exists.
- Library reopening, reload, selection changes and re-renders do not trigger downloads.
- Download request failures do not prevent playback or library persistence.
- Separate temporary download URLs survive player selection changes and are revoked after 60 seconds or on unmount. Cleanup, exact byte views, unsupported paths and failures have unit coverage.
- Browser policies still control automatic/multiple downloads and destination prompts. The application cannot bypass those settings or infer successful disk writes from anchor clicks; the UI reports requests, not confirmed saves.
- No transport, handshake, decoding or IndexedDB schema changes in this follow-up.
- Regression coverage now includes 42 unit cases and 48 E2E cases. The previous optional-picker tests remain in place, alongside four new auto-download cases.

## Previous repair: TV-RECEIVE-2

Base commit: `a6eaaf4b0344d6d41d7ec661c8b30fdda73d0e10`.

## Scope and evidence

Repair the post-receipt TV path, not speculative pairing timeouts. Three initial real-PCM-WAV browser regressions failed before implementation: generic MIME omitted the player, a multi-file QFPA delivery remained an opaque package, and a rejected `play()` promise was invisible.

The final desktop Chromium suites pass on both production adapters: 44 E2E cases on vinext and the same 44 on Next.js, plus 41 unit cases and 2 SSR cases. Type checking, lint, and both production builds pass. This is NOT physical LG/webOS, hardware audio output, or all-codec certification.

## Changes

- Validate fast-transfer headers, received byte count, overflow, and CRC before delivery. Preserve the existing 20 s connection / 15 s handshake / 45 s idle settings.
- Detect common media signatures and normalize generic MIME types. This does not transcode unsupported audio codecs.
- Unpack QFPA into independently selectable files; validate per-file CRC and signatures. Valid signatures are not automatically trusted. Reject burn-after-reading packages instead of silently retaining them in the TV library.
- Native media controls and explicit playback errors; no autoplay dependency. Revoke old Blob URLs. Construct Blobs from the exact byte view, not its entire backing buffer.
- Distinguish transport receipt, browser-local library persistence, decoding/playback, and a filesystem download. Anchor clicks are only "requested". Save-picker success requires write and close; cancellation does not fall through to an anchor; other save failures remain visible.
- IndexedDB v2 separates metadata from payloads, migrates v1 data, and waits for write transaction completion. Library listing no longer loads every file payload. A library storage failure does not prevent the already-received file from playing.
- Guard stale receiver/delivery work. Expensive browser-test globals are opt-in only. Add TV-RECEIVE-2 diagnostics without claiming that feature detection proves actual filesystem or codec support.
- Pairing instructions use the current origin instead of a hard-coded deployment URL.
- Run all unit tests in `npm test` and CI. Make the progress regression require nonzero observed updates, and the library regression actually accumulate two files in one origin/context.

## Reproduce

Use Node.js 22 and a compatible npm version.

```sh
npm ci
npm run lint
npx tsc --noEmit
npm test
npx playwright install --with-deps chromium
npm run test:e2e
npm run build:vercel
```

`npm test` runs all 41 unit tests, builds vinext production output, and runs the 2 SSR tests. E2E needs its generated fixtures and local PeerJS server; the existing `test:e2e` script handles them. The Playwright browser uses a UTF-8 locale on Linux so Arabic download names are tested correctly, rather than being replaced with `download` by Chromium under POSIX locale. Tests explicitly dismiss the tutorial overlay and opt into TV test hooks.

For the Next adapter, after `npm run build:vercel`, run Next production on another port and the local PeerJS server on port 9000, then run Playwright with `E2E_PORT` set to the Next port. Run the two full suites sequentially; simultaneous simulated-camera suites were noisy in the shared sandbox and were not used as final evidence.

## Deployment and migration cautions

- Verify the target commit and deployment separately. Test the new deployment on both phone and receiver, and confirm the TV-RECEIVE-3 diagnostic marker. The predecessor TV-RECEIVE-2 was published as e1c25e3.
- Close old same-origin tabs if IndexedDB reports a blocked upgrade. Do not clear browser storage as a routine update step: that deletes the user's library.
- The library moves to schema v2. Rolling the old v1-opening code back onto the same origin can produce `VersionError`. Back up important files before release and use a v2-compatible rollback strategy.
- Library persistence is browser-origin-local, not a Downloads-folder save, and remains subject to quota, eviction, and user clearing. Multi-file writes are per file, not one atomic transaction for the entire package; a later failure can leave a partial library import.
- The transport ACK still acknowledges complete CRC-checked transport bytes, not successful decoding, package application acceptance, or disk persistence.
- A device that refuses file downloads or lacks a codec cannot be made to support it merely by changing MIME metadata or increasing a handshake timeout. Use its reported player error and actual browser/model details to choose the next step.
