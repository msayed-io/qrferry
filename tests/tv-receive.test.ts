import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "../lib/optical-transfer";
import {
  FastReceiveBuffer,
  parseFastHeader,
  MAX_FAST_TRANSFER_BYTES,
} from "../lib/fast-receive-buffer";
import {
  receivedBlob,
  resolveMediaMime,
  unpackReceivedDelivery,
} from "../lib/received-media";
import { buildTransferPackage } from "../lib/transfer-package";
import {
  generateSigningKeyPair,
  exportPublicKeyRaw,
  signHash,
} from "../lib/signing";

const header = {
  passcode: "123456",
  name: "voice.wav",
  mime: "audio/wav",
  size: 4,
};
test("fast header rejects wrong passcode, malformed metadata and unsafe sizes before allocation", () => {
  assert.deepEqual(
    parseFastHeader(JSON.stringify(header), "123456", "123456"),
    header,
  );
  for (const size of [-1, 1.5, MAX_FAST_TRANSFER_BYTES + 1, "4", null])
    assert.throws(() =>
      parseFastHeader(JSON.stringify({ ...header, size }), "123456", "123456"),
    );
  assert.throws(() =>
    parseFastHeader(JSON.stringify(header), "123456", "000000"),
  );
  assert.throws(() =>
    parseFastHeader(JSON.stringify({ ...header, name: 3 }), "123456", "123456"),
  );
});
test("fast receiver never acknowledges a zero-padded incomplete file even if CRC matches", () => {
  const r = new FastReceiveBuffer(header);
  assert.throws(() => r.finish(crc32(new Uint8Array(4))), /ناقص/);
  r.push(new Uint8Array([0, 0]));
  assert.throws(() => r.finish(crc32(new Uint8Array(4))), /ناقص/);
});
test("fast receiver rejects overflow, corrupt checksums and duplicate completion", () => {
  const r = new FastReceiveBuffer(header);
  assert.throws(() => r.push(new Uint8Array(5)), /تتجاوز/);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  r.push(bytes);
  assert.throws(() => r.finish(0), /المجموع/);
  assert.deepEqual(r.finish(crc32(bytes)), bytes);
  assert.throws(() => r.finish(crc32(bytes)));
});
test("zero-length transfer completes only with its correct CRC", () => {
  const r = new FastReceiveBuffer({ ...header, size: 0 });
  assert.deepEqual(r.finish(0), new Uint8Array(0));
});
test("WAV bytes override generic MIME; extension fallback and common aliases are normalized", () => {
  const b = new TextEncoder().encode("RIFF0000WAVE");
  assert.equal(
    resolveMediaMime("recording", "application/octet-stream", b),
    "audio/wav",
  );
  assert.equal(
    resolveMediaMime("VOICE.MP3", "", new Uint8Array(0)),
    "audio/mpeg",
  );
  assert.equal(
    resolveMediaMime("voice", "audio/x-m4a", new Uint8Array(0)),
    "audio/mp4",
  );
  assert.equal(
    resolveMediaMime("notes.txt", "text/plain", new Uint8Array(0)),
    "text/plain",
  );
});
test("Blob includes exactly a Uint8Array subview, not its backing buffer", async () => {
  const bytes = new Uint8Array([99, 1, 2, 88]).subarray(1, 3);
  assert.deepEqual(
    new Uint8Array(await receivedBlob(bytes, "audio/wav").arrayBuffer()),
    new Uint8Array([1, 2]),
  );
});
test("TV unpacks and verifies each file in a QFPA package", async () => {
  const files = [
    {
      name: "a.wav",
      mime: "application/octet-stream",
      bytes: new TextEncoder().encode("RIFF0000WAVE"),
    },
    { name: "b.txt", mime: "text/plain", bytes: new Uint8Array([1, 2, 3]) },
  ];
  const bytes = buildTransferPackage({ files });
  const d = await unpackReceivedDelivery({
    name: "bundle",
    mime: "application/x-qrferry-package",
    bytes,
    size: bytes.length,
  });
  assert.equal(d.files.length, 2);
  assert.equal(d.files[0].mime, "audio/wav");
  assert.deepEqual(d.files[1].bytes, files[1].bytes);
  const bad = bytes.slice();
  bad[bad.length - 1] ^= 1;
  await assert.rejects(
    unpackReceivedDelivery({
      name: "bundle",
      mime: "application/x-qrferry-package",
      bytes: bad,
      size: bad.length,
    }),
    /المجموع/,
  );
});
test("TV explicitly rejects unsupported burn policy rather than silently persisting it", async () => {
  const bytes = buildTransferPackage({
    files: [{ name: "a", mime: "text/plain", bytes: new Uint8Array([1]) }],
    burnAfterReading: true,
  });
  await assert.rejects(
    unpackReceivedDelivery({
      name: "bundle",
      mime: "application/x-qrferry-package",
      size: bytes.length,
      bytes,
    }),
    /الحذف بعد القراءة غير مدعوم/,
  );
});
test("TV distinguishes a mathematically valid signature from a trusted identity and rejects tampering", async () => {
  const files = [
    { name: "a.wav", mime: "audio/wav", bytes: new Uint8Array([1, 2, 3]) },
  ];
  const pair = await generateSigningKeyPair(),
    pub = await exportPublicKeyRaw(pair.publicKey);
  const sig = await signHash(pair.privateKey, buildTransferPackage({ files }));
  const build = (signature: Uint8Array) => {
    const bytes = buildTransferPackage({
      files,
      signature,
      signerPublicKey: pub,
      signerName: "Unverified display name",
    });
    return {
      name: "bundle",
      mime: "application/x-qrferry-package",
      size: bytes.length,
      bytes,
    };
  };
  assert.equal(
    (await unpackReceivedDelivery(build(sig))).signature,
    "valid-untrusted",
  );
  assert.equal(
    (await unpackReceivedDelivery(build(sig), [pub])).signature,
    "valid-trusted",
  );
  sig[0] ^= 1;
  await assert.rejects(unpackReceivedDelivery(build(sig)), /فشل التحقق/);
});
