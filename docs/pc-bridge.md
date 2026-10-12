# `/pc` — two-way phone ↔ computer bridge

The `/pc` page pairs a phone and a computer over WebRTC (PeerJS) and keeps one open session where **both sides can send and receive chat messages and files**. Either device may show the pairing code. Neither side is restricted to a "big screen" role, and the page has no phone guard.

This is separate from the one-way `/tv` receiver and the optical (QR-stream) transfer. It does not change the `QF4`, `QFC4`, `QFCX`, `QFPA` or fast-LAN `QFTV` formats.

## Pairing

1. One device opens `/pc` and presses **Create pairing code**. It shows a QR code.
2. The other device either scans the QR with the in-app camera scanner, pastes the link, or opens the link directly. Opening the link auto-joins and then replaces the address with `/pc`, so the secret is not left in the address bar.

The QR encodes a URL:

```
<origin>/pc#QFB1.<base64url(JSON)>
```

The JSON contains these keys:

| key | meaning |
|---|---|
| `v` | payload version (`1`) |
| `p` | PeerJS peer id of the host |
| `s` | 22-character random secret (16 random bytes, base64url) |
| `h`, `o`, `r`, `t` | PeerJS signaling server host, port, path and TLS flag |

The payload is capped at 1024 characters. The QR is rendered with ECC level M. The version is the smallest in the range V10–V16 whose byte capacity fits the URL (`qrVersionFor` in `app/pc/pc-client.tsx`). The decoder accepts only an exact `QFB1.` payload at the start of the input or after `#`, and rejects anything else.

## Handshake and authentication

The secret never appears in the signaling metadata. Only the QR carries it, so a signaling-server observer cannot learn it. This is the difference from the `/tv` fast-LAN pairing, which places its passcode in the connection metadata.

Messages are JSON control frames:

1. Host → joiner: `hello{v, n}` with a host nonce.
2. Joiner → host: `auth{n, m}` with a joiner nonce and a proof.
3. Host → joiner: `welcome{m}` with the host proof.

Each proof is HMAC-SHA256 over `role|transcript`, verified with `crypto.subtle.verify`. The transcript is `QFB1|host=<fpH>|joiner=<fpJ>|hn=<nH>|jn=<nJ>`, where the fingerprints are the DTLS `a=fingerprint:sha-256` values from the SDP. The proof is therefore bound (channel binding) to the DTLS fingerprints of both sides: a proof captured on one DTLS channel does not verify on another, and a relay that terminates DTLS on either side cannot produce a valid proof without the secret, which is only in the QR. If a fingerprint is missing, authentication fails closed.

Other handshake rules:

- Nothing is accepted before `welcome`/`auth` succeeds.
- The handshake times out after 20 seconds.
- A protocol violation closes the channel.
- The host accepts one active channel. Any extra connection receives `busy`.
- After 5 failed authentications the host stops listening (`locked`) and asks the user to create a new code.
- Incoming messages are processed one at a time through a promise chain.

## Session messages and files

- **Chat**: `chat{id, text}`, up to 4000 characters, trimmed. Both directions are recorded in the local session log.
- **Files**, one at a time per direction, sent through a serial queue:
  `file-start{id, name, mime, size}` → `file-go` (or `file-ack ok:false reason:busy`) → binary chunks → `file-progress{id, received}` every 2 MB → `file-end{id, crc}` → `file-ack{ok, reason}`.
- Limits: `MAX_FILE_BYTES` (512 MB, shared with the rest of the app), name ≤ 255 characters, MIME ≤ 127 characters.
- The receiver verifies the byte count and a streaming CRC-32 before it exposes the file. Reasons for failure: `busy`, `incomplete`, `checksum`. Only verified files can be downloaded.
- Received files stay in memory for this page session only. Nothing is written to IndexedDB, and bytes never touch a server.

## Implementation map

| file | role |
|---|---|
| `lib/bridge-pairing.ts` | `QFB1` encode/decode, strict field validation, share URL |
| `lib/bridge-auth.ts` | secret generation, HMAC key import, DTLS fingerprints, transcript, proof compute/verify |
| `lib/bridge-channel.ts` | `BridgeChannel`: handshake, serialized inbox, chat, file send queue, file receive, CRC-32 helpers |
| `lib/bridge-session.ts` | `openBridgeHost` / `joinBridge` over PeerJS (dynamic `import("peerjs")`) |
| `app/pc/page.tsx`, `app/pc/pc-client.tsx`, `app/pc/pc.css` | the page: QR display, in-app scanner, paste input, auto-join, chat and file UI |

The `/pc` link is in the shared header (`app/workspace-ui.tsx`).

## Test hooks

When `window.__qrferryTestMode` is set, the page exposes `window.__qrferryBridge` (peer id, payload, URL, chat log, verified received files) and `window.__qrferryBridgeModules` (the QR module matrix, used to feed the camera stub). Nothing is exposed outside test mode.

## Verification

- `tests/bridge.test.ts`: 20 unit tests over an in-memory connection pair. They cover the handshake, a tampered transcript, missing fingerprints failing closed, busy and locked states, pairing decoder rejection of malformed or hostile input (including `//` path look-alikes), and byte-exact file transfer across many chunks in both directions.
- `e2e/bridge.spec.ts`: laptop shows the QR, the phone pairs through the camera stub, chat and 300 KB / 120 KB files move in both directions with byte-exact checks, pasted-link pairing, auto-join from the URL with address cleanup, and disconnect handling. Run each case in its own Playwright invocation on hosts where Chromium cannot keep multiple contexts alive (`--single-process` sandbox builds).

## Known limits

- Pairing uses the same PeerJS signaling defaults as `/tv` (overridable through `localStorage` key `qrferry-peer-host`). ICE uses PeerJS's default configuration (STUN plus its public TURN relay); a network that blocks every relay path can still prevent the connection.
- Only one active channel per host. A second device gets `busy`.
- Sessions are not persisted. Closing the page or disconnecting clears the session log.
