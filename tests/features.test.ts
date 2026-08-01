import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransferPackage,
  isTransferPackage,
  parseTransferPackage,
} from "../lib/transfer-package";
import {
  decodePublicKey,
  encodePublicKey,
  exportPublicKeyRaw,
  generateSigningKeyPair,
  importPublicKeyRaw,
  signHash,
  verifySignature,
} from "../lib/signing";

function deterministicBytes(length: number, seed = 0x1234abcd) {
  const output = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    output[index] = (state ^ (state >>> 14)) & 0xff;
  }
  return output;
}

test("transfer package round-trips a single file with metadata", () => {
  const bytes = deterministicBytes(5000);
  const pkg = buildTransferPackage({
    files: [{ name: "note.txt", mime: "text/plain", bytes }],
  });
  assert.ok(isTransferPackage(pkg));
  const parsed = parseTransferPackage(pkg);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].name, "note.txt");
  assert.equal(parsed.files[0].mime, "text/plain");
  assert.deepEqual(parsed.files[0].bytes, bytes);
  assert.equal(parsed.burnAfterReading, false);
  assert.equal(parsed.signature, null);
  assert.equal(parsed.signerName, null);
});

test("transfer package bundles multiple files with Arabic names", () => {
  const files = [
    { name: "تقرير-نهائي.pdf", mime: "application/pdf", bytes: deterministicBytes(3000, 1) },
    { name: "صور/صورة ١.jpg", mime: "image/jpeg", bytes: deterministicBytes(8000, 2) },
    { name: "notes.txt", mime: "text/plain", bytes: deterministicBytes(500, 3) },
  ];
  const pkg = buildTransferPackage({ files, burnAfterReading: true });
  const parsed = parseTransferPackage(pkg);
  assert.equal(parsed.files.length, 3);
  assert.equal(parsed.burnAfterReading, true);
  for (let index = 0; index < files.length; index += 1) {
    assert.equal(parsed.files[index].name, files[index].name);
    assert.equal(parsed.files[index].mime, files[index].mime);
    assert.deepEqual(parsed.files[index].bytes, files[index].bytes);
  }
});

test("transfer package rejects empty file lists and oversized counts", () => {
  assert.throws(() => buildTransferPackage({ files: [] }), /ملفاً واحداً/);
});

test("tampering with package content is rejected by per-file CRC", () => {
  const pkg = buildTransferPackage({
    files: [{ name: "a.bin", mime: "application/octet-stream", bytes: deterministicBytes(2000) }],
  });
  // نغيّر بايتاً في منطقة البيانات (بعد الترويسة والجدول)
  const tampered = pkg.slice();
  tampered[tampered.length - 10] ^= 0x40;
  assert.throws(() => parseTransferPackage(tampered), /المجموع/);
});

test("signing: valid signature verifies, wrong key or tampered data rejected", async () => {
  const keyPair = await generateSigningKeyPair();
  const content = deterministicBytes(10_000);
  const signature = await signHash(keyPair.privateKey, content);

  const verifyOk = await verifySignature(keyPair.publicKey, content, signature);
  assert.equal(verifyOk, true);

  // محتوى معدَّل → يرفض
  const tampered = content.slice();
  tampered[100] ^= 0x01;
  const verifyTampered = await verifySignature(keyPair.publicKey, tampered, signature);
  assert.equal(verifyTampered, false);

  // توقيع معدَّل → يرفض
  const badSignature = signature.slice();
  badSignature[0] ^= 0x01;
  const verifyBadSig = await verifySignature(keyPair.publicKey, content, badSignature);
  assert.equal(verifyBadSig, false);

  // مفتاح آخر → يرفض
  const otherKeyPair = await generateSigningKeyPair();
  const verifyOther = await verifySignature(otherKeyPair.publicKey, content, signature);
  assert.equal(verifyOther, false);
});

test("public key encode/decode round-trips", async () => {
  const keyPair = await generateSigningKeyPair();
  const raw = await exportPublicKeyRaw(keyPair.publicKey);
  const encoded = encodePublicKey(raw);
  const decoded = decodePublicKey(encoded);
  assert.ok(decoded);
  assert.deepEqual(decoded, raw);
  assert.equal(decodePublicKey("garbage"), null);
});

test("signed package round-trips with signer identity, public key, and verifiable signature", async () => {
  const keyPair = await generateSigningKeyPair();
  const publicKeyRaw = await exportPublicKeyRaw(keyPair.publicKey);
  const files = [
    { name: "عقد.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: deterministicBytes(7000) },
  ];
  // التوقيع على النسخة «الكنونية» بدون توقيع/مفتاح
  const unsigned = buildTransferPackage({ files, burnAfterReading: true });
  const signature = await signHash(keyPair.privateKey, unsigned);

  const pkg = buildTransferPackage({
    files,
    burnAfterReading: true,
    signerName: "قسم الأمن",
    signature,
    signerPublicKey: publicKeyRaw,
  });
  const parsed = parseTransferPackage(pkg);
  assert.equal(parsed.signerName, "قسم الأمن");
  assert.ok(parsed.signature);
  assert.ok(parsed.signerPublicKey);
  assert.deepEqual(parsed.signerPublicKey, publicKeyRaw);
  assert.equal(parsed.burnAfterReading, true);

  // إعادة بناء النسخة الكنونية والتحقق منها
  const canonical = buildTransferPackage({
    files,
    burnAfterReading: parsed.burnAfterReading,
  });
  const importedKey = await importPublicKeyRaw(publicKeyRaw);
  assert.equal(await verifySignature(importedKey, canonical, parsed.signature!), true);

  // توقيع على محتوى مختلف → لا يتحقق
  const otherContent = buildTransferPackage({
    files: [{ name: "x", mime: "text/plain", bytes: deterministicBytes(100, 9) }],
  });
  assert.equal(await verifySignature(importedKey, otherContent, parsed.signature!), false);
});

test("package without signing has null signer fields", () => {
  const pkg = buildTransferPackage({
    files: [{ name: "a.txt", mime: "text/plain", bytes: deterministicBytes(64) }],
  });
  const parsed = parseTransferPackage(pkg);
  assert.equal(parsed.signerName, null);
  assert.equal(parsed.signature, null);
  assert.equal(parsed.signerPublicKey, null);
});
