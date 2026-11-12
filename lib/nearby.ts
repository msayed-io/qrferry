/**
 * Radar pairing: profile model, advertisement payload and the pure parts of the
 * discovery state machine. Everything here is platform free so it can be tested
 * without a device; the native layer only advertises the string this module
 * builds and reports back what it saw.
 */

export const ADVERTISEMENT_LIMIT = 131; // Nearby Connections endpoint-name limit
export const SERVICE_ID = 'com.msayed.qrferry';
export const ADVERTISEMENT_PREFIX = 'QFR1';
export const DEFAULT_AVATAR_COUNT = 10;
export const NAME_MAX_GRAPHEMES = 24;

export interface Profile {
  userId: string;
  displayName: string;
  avatarType: 'default' | 'custom';
  defaultAvatarIndex: number;
  avatarVersion: number;
  hasCustomAvatar: boolean;
  avatar?: string; // data URL of the current avatar, when the platform can render it
  createdAt: number;
  updatedAt: number;
}

export interface Advertisement {
  v: number;
  id: string;
  name: string;
  avatarIndex: number; // DEFAULT_AVATAR_COUNT means "custom avatar"
  avatarVersion: number;
}

const encoder = new TextEncoder();
export const byteLength = (text: string) => encoder.encode(text).length;

/** Cut a string to a byte budget without splitting a code point. */
export function truncateBytes(text: string, limit: number) {
  if (byteLength(text) <= limit) return text;
  let out = '';
  for (const char of text) {
    if (byteLength(out + char) > limit) break;
    out += char;
  }
  return out;
}

function toBase64Url(text: string) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = typeof atob === 'function'
    ? atob(padded)
    : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

/**
 * Build the advertised endpoint name. The display name is base64url-encoded so
 * the separator can never appear inside it, and it is shortened (on code point
 * boundaries) until the whole payload fits the 131-byte ceiling.
 */
export function encodeAdvertisement(profile: Pick<Profile, 'userId' | 'displayName' | 'avatarType' | 'defaultAvatarIndex' | 'avatarVersion'>) {
  const id = (profile.userId || '').replace(/-/g, '').slice(0, 8) || '00000000';
  const avatarIndex = profile.avatarType === 'custom' ? DEFAULT_AVATAR_COUNT : profile.defaultAvatarIndex;
  const head = `${ADVERTISEMENT_PREFIX}|1|${id}|${avatarIndex}|${Math.max(0, profile.avatarVersion | 0)}|`;
  const budget = Math.max(0, ADVERTISEMENT_LIMIT - byteLength(head));
  // base64url inflates by 4/3: shorten the name itself (never the encoded text,
  // which would leave a half character or a broken group) until it fits.
  let limit = Math.floor((budget * 3) / 4);
  let name = truncateBytes(sanitizeName(profile.displayName), limit);
  while (limit > 0 && byteLength(toBase64Url(name)) > budget) {
    limit -= 1;
    name = truncateBytes(name, limit);
  }
  const payload = head + toBase64Url(name);
  if (byteLength(payload) > ADVERTISEMENT_LIMIT) throw new Error('ADVERTISEMENT_TOO_LONG');
  return payload;
}

/** Returns undefined for anything that is not one of our advertisements. */
export function decodeAdvertisement(payload: string): Advertisement | undefined {
  if (typeof payload !== 'string' || !payload.startsWith(`${ADVERTISEMENT_PREFIX}|`)) return undefined;
  const parts = payload.split('|');
  if (parts.length !== 6) return undefined;
  const [, version, id, avatarIndex, avatarVersion, encodedName] = parts;
  if (version !== '1' || !/^[0-9a-f]{8}$/i.test(id)) return undefined;
  const index = Number(avatarIndex);
  const revision = Number(avatarVersion);
  if (!Number.isInteger(index) || index < 0 || index > DEFAULT_AVATAR_COUNT) return undefined;
  if (!Number.isInteger(revision) || revision < 0) return undefined;
  let name = '';
  try { name = fromBase64Url(encodedName); } catch { return undefined; }
  return { v: 1, id: id.toLowerCase(), name: sanitizeName(name), avatarIndex: index, avatarVersion: revision };
}

/** Whitespace is collapsed and control/bidi characters are removed. */
export function sanitizeName(value: string) {
  return (value || '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const graphemes = (value: string) => {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), part => part.segment);
  return Array.from(value);
};

export type NameIssue = 'empty' | 'too-long' | 'control' | 'bidi';
export const NAME_ISSUES: Record<NameIssue, [string, string]> = {
  empty: ['اكتب اسمًا حتى يظهر للآخرين.', 'Write a name so others can see you.'],
  'too-long': ['الاسم أطول من ٢٤ حرفًا.', 'The name is longer than 24 characters.'],
  control: ['الاسم يحتوي أحرف تحكم غير مسموحة.', 'The name contains control characters.'],
  bidi: ['الاسم يحتوي أحرف اتجاه مخفية غير مسموحة.', 'The name contains hidden direction characters.'],
};

/** Validates a user supplied name. An empty value means "use the default". */
export function validateName(raw: string): { name: string; issue?: NameIssue } {
  if (/[\u0000-\u001F\u007F-\u009F]/.test(raw || '')) return { name: sanitizeName(raw), issue: 'control' };
  if (/[\u202A-\u202E\u2066-\u2069]/.test(raw || '')) return { name: sanitizeName(raw), issue: 'bidi' };
  const name = sanitizeName(raw);
  if (!name) return { name, issue: 'empty' };
  if (graphemes(name).length > NAME_MAX_GRAPHEMES) return { name, issue: 'too-long' };
  return { name };
}

/** `مستخدم_4829`: a localised word, an underscore and four random digits. */
export function defaultName(word: string, random: () => number = secureRandom) {
  const digits = String(random()).padStart(4, '0').slice(-4);
  return `${word}_${digits}`;
}

function secureRandom() {
  const buffer = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buffer);
  else buffer[0] = Math.floor(Math.random() * 10000);
  return buffer[0] % 10000;
}

/** Deterministic pseudo position on the radar ring: the APIs give no bearing. */
export function radarSlot(id: string, slots = 8) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % slots;
}

export type DiscoveryState = 'idle' | 'checking' | 'advertising' | 'discovering' | 'connecting' | 'awaiting' | 'connected' | 'error';

export interface PeerEntry { endpointId: string; id: string; name: string; avatarIndex: number; avatarVersion: number; lostAt?: number }
export interface PeerBucket { peers: PeerEntry[]; rejected: Record<string, number> }

export const LOST_GRACE_MS = 4000;
export const REJECT_COOLDOWN_MS = 60000;

/** Adds or refreshes a peer; a re-advertisement clears a pending loss. */
export function upsertPeer(bucket: PeerBucket, peer: PeerEntry): PeerBucket {
  const rest = bucket.peers.filter(entry => entry.endpointId !== peer.endpointId && entry.id !== peer.id);
  return { ...bucket, peers: [{ ...peer, lostAt: undefined }, ...rest] };
}

export function markPeerLost(bucket: PeerBucket, endpointId: string, now: number): PeerBucket {
  return { ...bucket, peers: bucket.peers.map(entry => (entry.endpointId === endpointId ? { ...entry, lostAt: now } : entry)) };
}

/** Peers whose grace period elapsed disappear from the radar. */
export function prunePeers(bucket: PeerBucket, now: number): PeerBucket {
  return { ...bucket, peers: bucket.peers.filter(entry => entry.lostAt === undefined || now - entry.lostAt < LOST_GRACE_MS) };
}

export function isRejected(bucket: PeerBucket, id: string, now: number) {
  const at = bucket.rejected[id];
  return at !== undefined && now - at < REJECT_COOLDOWN_MS;
}

export function rejectPeer(bucket: PeerBucket, id: string, now: number): PeerBucket {
  return { ...bucket, rejected: { ...bucket.rejected, [id]: now } };
}
