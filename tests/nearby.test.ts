import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVERTISEMENT_LIMIT, DEFAULT_AVATAR_COUNT, LOST_GRACE_MS, NAME_ISSUES,
  byteLength, decodeAdvertisement, defaultName, encodeAdvertisement, isRejected,
  markPeerLost, prunePeers, radarSlot, rejectPeer, sanitizeName, truncateBytes,
  upsertPeer, validateName, type PeerBucket, type Profile,
} from '../lib/nearby';

const profile: Profile = {
  userId: '3f2a91c4-77bb-4a51-9f5e-0c1d2e3f4a5b', displayName: 'أحمد البطل',
  avatarType: 'default', defaultAvatarIndex: 3, avatarVersion: 0,
  hasCustomAvatar: false, createdAt: 0, updatedAt: 0,
};

test('the profile is advertised well inside the endpoint-name limit', () => {
  const payload = encodeAdvertisement(profile);
  assert.ok(byteLength(payload) <= ADVERTISEMENT_LIMIT, `payload is ${byteLength(payload)} bytes`);
  const decoded = decodeAdvertisement(payload);
  assert.ok(decoded);
  assert.equal(decoded!.id, '3f2a91c4');
  assert.equal(decoded!.name, 'أحمد البطل');
  assert.equal(decoded!.avatarIndex, 3);
});

test('a custom avatar advertises the sentinel, never the picture', () => {
  const payload = encodeAdvertisement({ ...profile, avatarType: 'custom', avatarVersion: 7 });
  const decoded = decodeAdvertisement(payload)!;
  assert.equal(decoded.avatarIndex, DEFAULT_AVATAR_COUNT);
  assert.equal(decoded.avatarVersion, 7);
  assert.ok(!payload.includes('/9j/'), 'a JPEG cannot be inside the advertisement');
});

test('a very long name is shortened on a code point boundary and still fits', () => {
  const long = 'اسم طويل جدًا '.repeat(20);
  const payload = encodeAdvertisement({ ...profile, displayName: long });
  assert.ok(byteLength(payload) <= ADVERTISEMENT_LIMIT);
  const decoded = decodeAdvertisement(payload)!;
  assert.ok(decoded.name.length > 0);
  assert.ok(!decoded.name.includes('\uFFFD'), 'no code point may be split');
  assert.ok(long.startsWith(decoded.name), 'the advertised name is a real prefix of the full one');
});

test('truncateBytes never splits a multi byte character', () => {
  const text = 'مستخدم_4829';
  for (let limit = 1; limit <= byteLength(text); limit += 1) {
    const cut = truncateBytes(text, limit);
    assert.ok(byteLength(cut) <= limit);
    assert.ok(!cut.includes('\uFFFD'));
  }
});

test('foreign or broken advertisements are rejected instead of half parsed', () => {
  for (const value of ['', 'QFL1:{"a":1}', 'QFR1|2|zzzzzzzz|1|0|QQ', 'QFR1|1|aaaaaaaa|99|0|QQ', 'QFR1|1|aaaaaaaa|1|-1|QQ', 'QFR1|1|aaaaaaaa|1|0']) {
    assert.equal(decodeAdvertisement(value), undefined, value);
  }
});

test('name rules: trimming, bidi and control characters, grapheme length', () => {
  assert.equal(validateName('  أحمد   علي  ').name, 'أحمد علي');
  assert.equal(validateName('').issue, 'empty');
  assert.equal(validateName('a\u202Eevil').issue, 'bidi');
  assert.equal(validateName('bell\u0007').issue, 'control');
  const emoji = '👨‍👩‍👧‍👦';
  assert.equal(validateName(emoji.repeat(24)).issue, undefined, 'graphemes, not code units');
  assert.equal(validateName(emoji.repeat(25)).issue, 'too-long');
  assert.ok(NAME_ISSUES.bidi[0].length > 0 && NAME_ISSUES.bidi[1].length > 0);
  assert.equal(sanitizeName('\u2066hi\u2069'), 'hi');
});

test('the default name is a word, an underscore and four digits', () => {
  const name = defaultName('مستخدم', () => 428);
  assert.equal(name, 'مستخدم_0428');
  assert.match(name, /_\d{4}$/);
});

test('the radar position is decorative but stable for a given id', () => {
  assert.equal(radarSlot('abc12345'), radarSlot('abc12345'));
  for (const id of ['a1b2c3d4', 'ffffffff', '00000000', 'مستخدم']) {
    const slot = radarSlot(id);
    assert.ok(slot >= 0 && slot < 8);
  }
});

test('discovery keeps one entry per device and survives a brief loss', () => {
  let bucket: PeerBucket = { peers: [], rejected: {} };
  bucket = upsertPeer(bucket, { endpointId: 'e1', id: 'aaaa1111', name: 'A', avatarIndex: 1, avatarVersion: 0 });
  bucket = upsertPeer(bucket, { endpointId: 'e2', id: 'aaaa1111', name: 'A', avatarIndex: 1, avatarVersion: 0 });
  assert.equal(bucket.peers.length, 1, 'the same device seen twice is one row');
  // A device that re-advertises is stored under its newest endpoint id.
  const live = bucket.peers[0].endpointId;
  bucket = markPeerLost(bucket, live, 1000);
  assert.equal(prunePeers(bucket, 1000 + LOST_GRACE_MS - 1).peers.length, 1, 'the grace period keeps it');
  assert.equal(prunePeers(bucket, 1000 + LOST_GRACE_MS + 1).peers.length, 0, 'after the grace it goes');
  bucket = upsertPeer(bucket, { endpointId: live, id: 'aaaa1111', name: 'A', avatarIndex: 1, avatarVersion: 0 });
  assert.equal(bucket.peers[0].lostAt, undefined, 'a re-advertisement clears the loss');
});

test('a rejected device is not offered again for a minute', () => {
  let bucket: PeerBucket = { peers: [], rejected: {} };
  bucket = rejectPeer(bucket, 'aaaa1111', 1000);
  assert.equal(isRejected(bucket, 'aaaa1111', 1000 + 59000), true);
  assert.equal(isRejected(bucket, 'aaaa1111', 1000 + 61000), false);
  assert.equal(isRejected(bucket, 'bbbb2222', 1000), false);
});
