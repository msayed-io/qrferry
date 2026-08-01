import type { CompressionMode } from "./compression";

const MAGIC = new Uint8Array([0x51, 0x46, 0x33]); // QF3
const FRAME_TYPE_DESCRIPTOR = 0;
const FRAME_TYPE_DATA = 1;
const FLAG_SYSTEMATIC = 1;
const FLAG_GZIP = 2;
const DATA_HEADER_BYTES = 21;
const DESCRIPTOR_HEADER_BYTES = 35;
const CRC_BYTES = 4;
const PREFIX = "QF3:";
const BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const FRAME_PREFIX = PREFIX;
export const LEGACY_FRAME_PREFIXES = ["QRF1:", "QRF2:"];

export type TransferMeta = {
  sessionId: string;
  sessionBytes: Uint8Array;
  filename: string;
  mime: string;
  fileSize: number;
  transmittedSize: number;
  blockSize: number;
  blockCount: number;
  fileCrc: number;
  transmittedCrc: number;
  compression: CompressionMode;
};

export type TransferSource = {
  meta: TransferMeta;
  blocks: Uint8Array[];
  degreeCdf: Float64Array;
};

export type Droplet = {
  meta: TransferMeta;
  sequence: number;
  seed: number;
  degree: number;
  systematic: boolean;
  indices: number[];
  payload: Uint8Array;
};

export type DescriptorFrame = {
  kind: "descriptor";
  meta: TransferMeta;
};

export type DataFrame = {
  kind: "data";
  sessionId: string;
  sessionBytes: Uint8Array;
  sequence: number;
  seed: number;
  degree: number;
  systematic: boolean;
  payload: Uint8Array;
};

export type TransferFrame = DescriptorFrame | DataFrame;

export type ReceiveResult = {
  accepted: boolean;
  duplicate: boolean;
  complete: boolean;
  solved: number;
  total: number;
};

type Equation = {
  indices: Set<number>;
  payload: Uint8Array;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let crcTable: Uint32Array | undefined;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[n] = value >>> 0;
  }
  return crcTable;
}

export function crc32(bytes: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function randomSessionBytes() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function truncateUtf8(value: string, maxBytes: number) {
  let candidate = value;
  while (textEncoder.encode(candidate).length > maxBytes) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

function truncateFilename(value: string, maxBytes: number) {
  if (textEncoder.encode(value).length <= maxBytes) return value;
  const lastDot = value.lastIndexOf(".");
  const extension =
    lastDot > 0 && textEncoder.encode(value.slice(lastDot)).length <= 12
      ? value.slice(lastDot)
      : "";
  const suffix = `…${extension}`;
  const suffixBytes = textEncoder.encode(suffix).length;
  const base = extension ? value.slice(0, lastDot) : value;
  return `${truncateUtf8(base, Math.max(1, maxBytes - suffixBytes))}${suffix}`;
}

function mix32(input: number) {
  let value = input >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function makeRng(seed: number) {
  let state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function robustSolitonCdf(blockCount: number) {
  if (blockCount === 1) return new Float64Array([1]);
  const c = 0.12;
  const delta = 0.08;
  const r = c * Math.log(blockCount / delta) * Math.sqrt(blockCount);
  const pivot = Math.max(1, Math.min(blockCount, Math.floor(blockCount / r)));
  const probabilities = new Float64Array(blockCount);
  let total = 0;

  for (let degree = 1; degree <= blockCount; degree += 1) {
    const rho = degree === 1 ? 1 / blockCount : 1 / (degree * (degree - 1));
    let tau = 0;
    if (degree < pivot) tau = r / (degree * blockCount);
    if (degree === pivot) tau = (r * Math.log(r / delta)) / blockCount;
    probabilities[degree - 1] = rho + Math.max(0, tau);
    total += probabilities[degree - 1];
  }

  const cdf = new Float64Array(blockCount);
  let running = 0;
  for (let index = 0; index < blockCount; index += 1) {
    running += probabilities[index] / total;
    cdf[index] = running;
  }
  cdf[blockCount - 1] = 1;
  return cdf;
}

function sampleDegree(cdf: Float64Array, sample: number) {
  let low = 0;
  let high = cdf.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sample <= cdf[middle]) high = middle;
    else low = middle + 1;
  }
  return low + 1;
}

export function indicesForDroplet(
  blockCount: number,
  degree: number,
  seed: number,
  systematic: boolean,
) {
  if (blockCount < 1 || degree < 1 || degree > blockCount) {
    throw new Error("Invalid fountain-code parameters.");
  }
  if (systematic) return [seed % blockCount];

  const random = makeRng(seed ^ 0xa5f1523d);
  const selected = new Set<number>();
  for (let cursor = blockCount - degree; cursor < blockCount; cursor += 1) {
    const candidate = random() % (cursor + 1);
    selected.add(selected.has(candidate) ? cursor : candidate);
  }
  return Array.from(selected).sort((a, b) => a - b);
}

export function createTransferSource(
  bytes: Uint8Array,
  options: {
    filename: string;
    mime?: string;
    blockSize: number;
    sessionBytes?: Uint8Array;
    originalSize?: number;
    originalCrc?: number;
    compression?: CompressionMode;
  },
): TransferSource {
  const originalSize = options.originalSize ?? bytes.byteLength;
  if (originalSize > MAX_FILE_BYTES || bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("This browser build supports files up to 512 MB.");
  }
  if (!Number.isInteger(options.blockSize) || options.blockSize < 128 || options.blockSize > 1200) {
    throw new Error("Block size must be between 128 and 1200 bytes.");
  }

  const sessionBytes = options.sessionBytes?.slice() ?? randomSessionBytes();
  if (sessionBytes.length !== 6) throw new Error("Session IDs must be 6 bytes.");
  const filename = truncateFilename(options.filename || "transfer.bin", 48);
  const requestedMime = options.mime || "application/octet-stream";
  const mime =
    textEncoder.encode(requestedMime).length <= 32
      ? requestedMime
      : "application/octet-stream";
  const blockCount = Math.max(1, Math.ceil(bytes.length / options.blockSize));
  const blocks: Uint8Array[] = [];

  for (let index = 0; index < blockCount; index += 1) {
    const block = new Uint8Array(options.blockSize);
    const start = index * options.blockSize;
    block.set(bytes.subarray(start, Math.min(start + options.blockSize, bytes.length)));
    blocks.push(block);
  }

  const meta: TransferMeta = {
    sessionId: bytesToHex(sessionBytes),
    sessionBytes,
    filename,
    mime,
    fileSize: originalSize,
    transmittedSize: bytes.length,
    blockSize: options.blockSize,
    blockCount,
    fileCrc: options.originalCrc ?? crc32(bytes),
    transmittedCrc: crc32(bytes),
    compression: options.compression ?? "none",
  };

  return { meta, blocks, degreeCdf: robustSolitonCdf(blockCount) };
}

function xorInto(target: Uint8Array, source: Uint8Array) {
  for (let index = 0; index < target.length; index += 1) target[index] ^= source[index];
}

export function createDroplet(source: TransferSource, sequence: number): Droplet {
  const normalizedSequence = sequence >>> 0;
  const systematic = normalizedSequence < source.meta.blockCount;
  const sessionWord = new DataView(
    source.meta.sessionBytes.buffer,
    source.meta.sessionBytes.byteOffset,
    source.meta.sessionBytes.byteLength,
  ).getUint32(0, true);
  const seed = systematic
    ? normalizedSequence
    : mix32(normalizedSequence ^ sessionWord ^ 0x51f15e11);
  const degree = systematic
    ? 1
    : sampleDegree(source.degreeCdf, makeRng(seed ^ 0xc2b2ae35)() / 0x100000000);
  const indices = indicesForDroplet(source.meta.blockCount, degree, seed, systematic);
  const payload = new Uint8Array(source.meta.blockSize);
  for (const index of indices) xorInto(payload, source.blocks[index]);

  return {
    meta: source.meta,
    sequence: normalizedSequence,
    seed,
    degree,
    systematic,
    indices,
    payload,
  };
}

function bytesToBase45(bytes: Uint8Array) {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 2) {
    if (index + 1 < bytes.length) {
      let value = bytes[index] * 256 + bytes[index + 1];
      const first = value % 45;
      value = Math.floor(value / 45);
      const second = value % 45;
      const third = Math.floor(value / 45);
      encoded += BASE45_ALPHABET[first] + BASE45_ALPHABET[second] + BASE45_ALPHABET[third];
    } else {
      const value = bytes[index];
      encoded += BASE45_ALPHABET[value % 45] + BASE45_ALPHABET[Math.floor(value / 45)];
    }
  }
  return encoded;
}

function base45ToBytes(value: string) {
  if (value.length % 3 === 1) throw new Error("Invalid Base45 frame length.");
  const output: number[] = [];
  for (let index = 0; index < value.length; ) {
    const groupLength = value.length - index >= 3 ? 3 : 2;
    const first = BASE45_ALPHABET.indexOf(value[index]);
    const second = BASE45_ALPHABET.indexOf(value[index + 1]);
    if (first < 0 || second < 0) throw new Error("Invalid Base45 character.");
    if (groupLength === 3) {
      const third = BASE45_ALPHABET.indexOf(value[index + 2]);
      if (third < 0) throw new Error("Invalid Base45 character.");
      const decoded = first + second * 45 + third * 45 * 45;
      if (decoded > 0xffff) throw new Error("Invalid Base45 value.");
      output.push(decoded >>> 8, decoded & 0xff);
    } else {
      const decoded = first + second * 45;
      if (decoded > 0xff) throw new Error("Invalid Base45 value.");
      output.push(decoded);
    }
    index += groupLength;
  }
  return new Uint8Array(output);
}

function finalizePacket(packet: Uint8Array, payloadEnd: number) {
  new DataView(packet.buffer).setUint32(payloadEnd, crc32(packet.subarray(0, payloadEnd)), true);
  return PREFIX + bytesToBase45(packet);
}

export function encodeDescriptor(sourceOrMeta: TransferSource | TransferMeta) {
  const meta = "meta" in sourceOrMeta ? sourceOrMeta.meta : sourceOrMeta;
  const nameBytes = textEncoder.encode(meta.filename);
  const mimeBytes = textEncoder.encode(meta.mime);
  const packet = new Uint8Array(
    DESCRIPTOR_HEADER_BYTES + nameBytes.length + mimeBytes.length + CRC_BYTES,
  );
  const view = new DataView(packet.buffer);
  let offset = 0;
  packet.set(MAGIC, offset);
  offset += 3;
  view.setUint8(offset, FRAME_TYPE_DESCRIPTOR);
  offset += 1;
  view.setUint8(offset, meta.compression === "gzip" ? FLAG_GZIP : 0);
  offset += 1;
  packet.set(meta.sessionBytes, offset);
  offset += 6;
  view.setUint32(offset, meta.fileSize, true);
  offset += 4;
  view.setUint32(offset, meta.transmittedSize, true);
  offset += 4;
  view.setUint16(offset, meta.blockSize, true);
  offset += 2;
  view.setUint32(offset, meta.blockCount, true);
  offset += 4;
  view.setUint32(offset, meta.fileCrc, true);
  offset += 4;
  view.setUint32(offset, meta.transmittedCrc, true);
  offset += 4;
  view.setUint8(offset, nameBytes.length);
  offset += 1;
  view.setUint8(offset, mimeBytes.length);
  offset += 1;
  packet.set(nameBytes, offset);
  offset += nameBytes.length;
  packet.set(mimeBytes, offset);
  offset += mimeBytes.length;
  return finalizePacket(packet, offset);
}

export function encodeDroplet(droplet: Droplet) {
  const packet = new Uint8Array(DATA_HEADER_BYTES + droplet.payload.length + CRC_BYTES);
  const view = new DataView(packet.buffer);
  let offset = 0;
  packet.set(MAGIC, offset);
  offset += 3;
  view.setUint8(offset, FRAME_TYPE_DATA);
  offset += 1;
  view.setUint8(offset, droplet.systematic ? FLAG_SYSTEMATIC : 0);
  offset += 1;
  packet.set(droplet.meta.sessionBytes, offset);
  offset += 6;
  view.setUint32(offset, droplet.sequence, true);
  offset += 4;
  view.setUint32(offset, droplet.seed, true);
  offset += 4;
  view.setUint16(offset, droplet.degree, true);
  offset += 2;
  packet.set(droplet.payload, offset);
  offset += droplet.payload.length;
  return finalizePacket(packet, offset);
}

function decodePacket(value: string) {
  if (!value.startsWith(PREFIX)) throw new Error("Not a QRFerry v3 frame.");
  const packet = base45ToBytes(value.slice(PREFIX.length));
  if (packet.length < DESCRIPTOR_HEADER_BYTES + CRC_BYTES) {
    throw new Error("Truncated QRFerry frame.");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const expectedCrc = view.getUint32(packet.length - CRC_BYTES, true);
  const actualCrc = crc32(packet.subarray(0, packet.length - CRC_BYTES));
  if (expectedCrc !== actualCrc) throw new Error("Frame checksum failed.");
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (packet[index] !== MAGIC[index]) throw new Error("Unknown QRFerry frame format.");
  }
  return { packet, view };
}

export function decodeTransferFrame(value: string): TransferFrame {
  const { packet, view } = decodePacket(value);
  let offset = MAGIC.length;
  const type = view.getUint8(offset);
  offset += 1;
  const flags = view.getUint8(offset);
  offset += 1;
  const sessionBytes = packet.slice(offset, offset + 6);
  const sessionId = bytesToHex(sessionBytes);
  offset += 6;

  if (type === FRAME_TYPE_DESCRIPTOR) {
    const fileSize = view.getUint32(offset, true);
    offset += 4;
    const transmittedSize = view.getUint32(offset, true);
    offset += 4;
    const blockSize = view.getUint16(offset, true);
    offset += 2;
    const blockCount = view.getUint32(offset, true);
    offset += 4;
    const fileCrc = view.getUint32(offset, true);
    offset += 4;
    const transmittedCrc = view.getUint32(offset, true);
    offset += 4;
    const nameLength = view.getUint8(offset);
    offset += 1;
    const mimeLength = view.getUint8(offset);
    offset += 1;
    const expectedLength =
      DESCRIPTOR_HEADER_BYTES + nameLength + mimeLength + CRC_BYTES;
    if (
      packet.length !== expectedLength ||
      blockSize < 128 ||
      blockSize > 1200 ||
      blockCount < 1 ||
      transmittedSize > blockSize * blockCount ||
      (blockCount > 1 && transmittedSize <= blockSize * (blockCount - 1))
    ) {
      throw new Error("Invalid QRFerry descriptor.");
    }
    const filename = textDecoder.decode(packet.subarray(offset, offset + nameLength));
    offset += nameLength;
    const mime = textDecoder.decode(packet.subarray(offset, offset + mimeLength));
    return {
      kind: "descriptor",
      meta: {
        sessionId,
        sessionBytes,
        filename,
        mime,
        fileSize,
        transmittedSize,
        blockSize,
        blockCount,
        fileCrc,
        transmittedCrc,
        compression: (flags & FLAG_GZIP) !== 0 ? "gzip" : "none",
      },
    };
  }

  if (type === FRAME_TYPE_DATA) {
    const sequence = view.getUint32(offset, true);
    offset += 4;
    const seed = view.getUint32(offset, true);
    offset += 4;
    const degree = view.getUint16(offset, true);
    offset += 2;
    const payloadLength = packet.length - DATA_HEADER_BYTES - CRC_BYTES;
    if (payloadLength < 128 || payloadLength > 1200 || degree < 1) {
      throw new Error("Invalid QRFerry data frame.");
    }
    return {
      kind: "data",
      sessionId,
      sessionBytes,
      sequence,
      seed,
      degree,
      systematic: (flags & FLAG_SYSTEMATIC) !== 0,
      payload: packet.slice(offset, offset + payloadLength),
    };
  }
  throw new Error("Unknown QRFerry frame type.");
}

export function materializeDroplet(frame: DataFrame, meta: TransferMeta): Droplet {
  if (
    frame.sessionId !== meta.sessionId ||
    frame.payload.length !== meta.blockSize ||
    frame.degree > meta.blockCount
  ) {
    throw new Error("That frame belongs to a different transfer.");
  }
  return {
    meta,
    sequence: frame.sequence,
    seed: frame.seed,
    degree: frame.degree,
    systematic: frame.systematic,
    indices: indicesForDroplet(
      meta.blockCount,
      frame.degree,
      frame.seed,
      frame.systematic,
    ),
    payload: frame.payload,
  };
}

export function decodeDroplet(value: string, meta: TransferMeta) {
  const frame = decodeTransferFrame(value);
  if (frame.kind !== "data") throw new Error("Expected a QRFerry data frame.");
  return materializeDroplet(frame, meta);
}

function sameTransfer(left: TransferMeta, right: TransferMeta) {
  return (
    left.sessionId === right.sessionId &&
    left.fileSize === right.fileSize &&
    left.transmittedSize === right.transmittedSize &&
    left.blockSize === right.blockSize &&
    left.blockCount === right.blockCount &&
    left.fileCrc === right.fileCrc &&
    left.transmittedCrc === right.transmittedCrc &&
    left.compression === right.compression
  );
}

export class FountainDecoder {
  meta?: TransferMeta;
  private readonly solved = new Map<number, Uint8Array>();
  private readonly equations = new Map<number, Equation>();
  private readonly adjacency = new Map<number, Set<number>>();
  private readonly seenSequences = new Set<number>();
  private nextEquationId = 1;

  initialize(meta: TransferMeta) {
    if (!this.meta) {
      this.meta = meta;
      return;
    }
    if (!sameTransfer(this.meta, meta)) {
      throw new Error("That descriptor belongs to a different transfer.");
    }
  }

  get solvedCount() {
    return this.solved.size;
  }

  get totalCount() {
    return this.meta?.blockCount ?? 0;
  }

  get progress() {
    return this.totalCount === 0 ? 0 : this.solvedCount / this.totalCount;
  }

  get isComplete() {
    return this.totalCount > 0 && this.solvedCount === this.totalCount;
  }

  receiveData(frame: DataFrame) {
    if (!this.meta) throw new Error("Waiting for the transfer descriptor.");
    return this.receive(materializeDroplet(frame, this.meta));
  }

  receive(droplet: Droplet): ReceiveResult {
    if (!this.meta) this.meta = droplet.meta;
    if (!sameTransfer(this.meta, droplet.meta)) {
      throw new Error("That frame belongs to a different transfer.");
    }
    if (this.seenSequences.has(droplet.sequence)) {
      return {
        accepted: false,
        duplicate: true,
        complete: this.isComplete,
        solved: this.solvedCount,
        total: this.totalCount,
      };
    }
    this.seenSequences.add(droplet.sequence);

    const payload = droplet.payload.slice();
    const unknown = new Set<number>();
    for (const index of droplet.indices) {
      const known = this.solved.get(index);
      if (known) xorInto(payload, known);
      else unknown.add(index);
    }
    if (unknown.size === 1) {
      this.solve(Array.from(unknown)[0], payload);
    } else if (unknown.size > 1) {
      this.addEquation(unknown, payload);
    }

    return {
      accepted: true,
      duplicate: false,
      complete: this.isComplete,
      solved: this.solvedCount,
      total: this.totalCount,
    };
  }

  private addEquation(indices: Set<number>, payload: Uint8Array) {
    const id = this.nextEquationId;
    this.nextEquationId += 1;
    this.equations.set(id, { indices, payload });
    for (const index of indices) {
      let linked = this.adjacency.get(index);
      if (!linked) {
        linked = new Set();
        this.adjacency.set(index, linked);
      }
      linked.add(id);
    }
  }

  private removeEquation(id: number) {
    const equation = this.equations.get(id);
    if (!equation) return;
    for (const index of equation.indices) {
      const linked = this.adjacency.get(index);
      linked?.delete(id);
      if (linked?.size === 0) this.adjacency.delete(index);
    }
    this.equations.delete(id);
  }

  private solve(initialIndex: number, initialPayload: Uint8Array) {
    const queue: Array<[number, Uint8Array]> = [[initialIndex, initialPayload]];
    while (queue.length > 0) {
      const [index, payload] = queue.shift()!;
      if (this.solved.has(index)) continue;
      this.solved.set(index, payload);
      const linkedIds = Array.from(this.adjacency.get(index) ?? []);
      this.adjacency.delete(index);
      for (const id of linkedIds) {
        const equation = this.equations.get(id);
        if (!equation || !equation.indices.delete(index)) continue;
        xorInto(equation.payload, payload);
        if (equation.indices.size === 0) {
          this.removeEquation(id);
        } else if (equation.indices.size === 1) {
          const nextIndex = Array.from(equation.indices)[0];
          const nextPayload = equation.payload;
          this.removeEquation(id);
          queue.push([nextIndex, nextPayload]);
        }
      }
    }
  }

  result() {
    if (!this.meta || !this.isComplete) throw new Error("The transfer is not complete.");
    const output = new Uint8Array(this.meta.blockCount * this.meta.blockSize);
    for (let index = 0; index < this.meta.blockCount; index += 1) {
      const block = this.solved.get(index);
      if (!block) throw new Error("A decoded block is missing.");
      output.set(block, index * this.meta.blockSize);
    }
    const trimmed = output.slice(0, this.meta.transmittedSize);
    if (crc32(trimmed) !== this.meta.transmittedCrc) {
      throw new Error("The transmitted stream checksum failed.");
    }
    return trimmed;
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
}

export function formatRate(bytesPerSecond: number) {
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}
