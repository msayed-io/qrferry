import { classifyRaptorQPackets } from "@raptorqr/core/sender/raptorq_packetizer";
import { encodeRaptorQPackets } from "@raptorqr/core/fec/raptorq_wasm";
import { CompressionMode } from "@/lib/compression";
import { isEncryptedPayload } from "@/lib/encryption";

const FRAME_MAGIC = new Uint8Array([0x51, 0x46, 0x34]); // QF4
const CONTAINER_MAGIC = new Uint8Array([0x51, 0x46, 0x43, 0x34]); // QFC4
const FRAME_HEADER_BYTES = 19;
const FRAME_CRC_BYTES = 4;
const CONTAINER_HEADER_BYTES = 23;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const OPTICAL_FRAME_OVERHEAD = FRAME_HEADER_BYTES + FRAME_CRC_BYTES;
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

export type OpticalFileMeta = {
  filename: string;
  mime: string;
  fileSize: number;
  transmittedSize: number;
  fileCrc: number;
  transmittedCrc: number;
  compression: CompressionMode;
  encrypted: boolean;
};

export type PreparedOpticalFile = {
  meta: OpticalFileMeta;
  container: Uint8Array;
};

export type OpticalTransfer = {
  meta: OpticalFileMeta;
  session: number;
  containerLength: number;
  symbolSize: number;
  sourcePacketCount: number;
  packets: Uint8Array[];
  sourcePacketIndices: number[];
  repairPacketIndices: number[];
};

export type OpticalFrame = {
  session: number;
  containerLength: number;
  originalSize: number;
  compressed: boolean;
  symbolSize: number;
  payload: Uint8Array;
};

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Prefix(value: string, maximumBytes: number) {
  const bytes = textEncoder.encode(value);
  if (bytes.length <= maximumBytes) return bytes;
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.slice(0, end);
}

export function buildOpticalContainer(
  original: Uint8Array,
  transmitted: Uint8Array,
  options: {
    filename: string;
    mime?: string;
    compression: CompressionMode;
  },
): PreparedOpticalFile {
  if (original.length > MAX_FILE_BYTES || transmitted.length > MAX_FILE_BYTES) {
    throw new Error("This browser build supports files up to 512 MB.");
  }

  const filenameBytes = utf8Prefix(options.filename || "transfer.bin", 255);
  const mimeBytes = utf8Prefix(
    options.mime || "application/octet-stream",
    255,
  );
  const fileCrc = crc32(original);
  const transmittedCrc = crc32(transmitted);
  const container = new Uint8Array(
    CONTAINER_HEADER_BYTES +
      filenameBytes.length +
      mimeBytes.length +
      transmitted.length,
  );
  const view = new DataView(container.buffer);
  container.set(CONTAINER_MAGIC, 0);
  container[4] =
    options.compression === "gzip"
      ? 1
      : options.compression === "brotli"
        ? 2
        : 0;
  container[5] = filenameBytes.length;
  container[6] = mimeBytes.length;
  view.setUint32(7, original.length, true);
  view.setUint32(11, fileCrc, true);
  view.setUint32(15, transmitted.length, true);
  view.setUint32(19, transmittedCrc, true);
  container.set(filenameBytes, CONTAINER_HEADER_BYTES);
  container.set(mimeBytes, CONTAINER_HEADER_BYTES + filenameBytes.length);
  container.set(
    transmitted,
    CONTAINER_HEADER_BYTES + filenameBytes.length + mimeBytes.length,
  );

  return {
    meta: {
      filename: textDecoder.decode(filenameBytes),
      mime: textDecoder.decode(mimeBytes),
      fileSize: original.length,
      transmittedSize: transmitted.length,
      fileCrc,
      transmittedCrc,
      compression: options.compression,
      encrypted: isEncryptedPayload(transmitted),
    },
    container,
  };
}

export function parseOpticalContainer(container: Uint8Array): {
  meta: OpticalFileMeta;
  transmitted: Uint8Array;
} {
  if (container.length < CONTAINER_HEADER_BYTES) {
    throw new Error("Recovered transfer is missing its file header.");
  }
  for (let index = 0; index < CONTAINER_MAGIC.length; index += 1) {
    if (container[index] !== CONTAINER_MAGIC[index]) {
      throw new Error("Recovered transfer has an invalid file header.");
    }
  }

  const view = new DataView(
    container.buffer,
    container.byteOffset,
    container.byteLength,
  );
  const compression: CompressionMode =
    container[4] === 1 ? "gzip" : container[4] === 2 ? "brotli" : "none";
  const filenameLength = container[5];
  const mimeLength = container[6];
  const fileSize = view.getUint32(7, true);
  const fileCrc = view.getUint32(11, true);
  const transmittedSize = view.getUint32(15, true);
  const transmittedCrc = view.getUint32(19, true);
  const payloadOffset =
    CONTAINER_HEADER_BYTES + filenameLength + mimeLength;
  if (payloadOffset + transmittedSize !== container.length) {
    throw new Error("Recovered transfer length did not match its file header.");
  }

  const filename = textDecoder.decode(
    container.subarray(
      CONTAINER_HEADER_BYTES,
      CONTAINER_HEADER_BYTES + filenameLength,
    ),
  );
  const mime = textDecoder.decode(
    container.subarray(
      CONTAINER_HEADER_BYTES + filenameLength,
      payloadOffset,
    ),
  );
  const transmitted = container.slice(payloadOffset);
  if (crc32(transmitted) !== transmittedCrc) {
    throw new Error("Recovered optical payload failed its checksum.");
  }

  return {
    meta: {
      filename: filename || "transfer.bin",
      mime: mime || "application/octet-stream",
      fileSize,
      transmittedSize,
      fileCrc,
      transmittedCrc,
      compression,
      encrypted: isEncryptedPayload(transmitted),
    },
    transmitted,
  };
}

function serializeFrame(
  payload: Uint8Array,
  options: {
    session: number;
    containerLength: number;
    originalSize: number;
    compressed: boolean;
    symbolSize: number;
  },
) {
  if (payload.length !== options.symbolSize) {
    throw new Error("RaptorQ symbol length does not match the transfer profile.");
  }
  const frame = new Uint8Array(
    FRAME_HEADER_BYTES + payload.length + FRAME_CRC_BYTES,
  );
  const view = new DataView(frame.buffer);
  frame.set(FRAME_MAGIC, 0);
  frame[3] = options.compressed ? 1 : 0;
  view.setUint32(4, options.session, true);
  view.setUint32(8, options.containerLength, true);
  view.setUint32(12, options.originalSize, true);
  view.setUint16(16, options.symbolSize, true);
  frame[18] = 1; // protocol revision
  frame.set(payload, FRAME_HEADER_BYTES);
  view.setUint32(
    FRAME_HEADER_BYTES + payload.length,
    crc32(frame.subarray(0, FRAME_HEADER_BYTES + payload.length)),
    true,
  );
  return frame;
}

export function parseOpticalFrame(frame: Uint8Array): OpticalFrame {
  if (frame.length < OPTICAL_FRAME_OVERHEAD + 5) {
    throw new Error("Optical frame is too short.");
  }
  for (let index = 0; index < FRAME_MAGIC.length; index += 1) {
    if (frame[index] !== FRAME_MAGIC[index]) {
      throw new Error("This is not a QRFerry v4 optical frame.");
    }
  }
  if (frame[18] !== 1) throw new Error("Unsupported optical frame revision.");

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const symbolSize = view.getUint16(16, true);
  if (frame.length !== FRAME_HEADER_BYTES + symbolSize + FRAME_CRC_BYTES) {
    throw new Error("Optical frame length does not match its header.");
  }
  const expectedCrc = view.getUint32(FRAME_HEADER_BYTES + symbolSize, true);
  const actualCrc = crc32(frame.subarray(0, FRAME_HEADER_BYTES + symbolSize));
  if (expectedCrc !== actualCrc) {
    throw new Error("Optical frame checksum failed.");
  }

  return {
    session: view.getUint32(4, true),
    containerLength: view.getUint32(8, true),
    originalSize: view.getUint32(12, true),
    compressed: (frame[3] & 1) === 1,
    symbolSize,
    payload: frame.slice(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + symbolSize),
  };
}

export async function createOpticalTransfer(
  prepared: PreparedOpticalFile,
  options: {
    symbolSize: number;
    repairPercent: number;
  },
): Promise<OpticalTransfer> {
  if (!Number.isInteger(options.symbolSize) || options.symbolSize < 128) {
    throw new Error("The optical symbol size is invalid.");
  }
  const session = crc32(prepared.container);
  const encoded = await encodeRaptorQPackets(
    prepared.container,
    options.symbolSize,
    options.repairPercent,
  );
  const classification = classifyRaptorQPackets(
    encoded,
    prepared.container.length,
    options.symbolSize,
  );
  const packets = encoded.map((payload) =>
    serializeFrame(payload, {
      session,
      containerLength: prepared.container.length,
      originalSize: prepared.meta.fileSize,
      compressed: prepared.meta.compression !== "none",
      symbolSize: options.symbolSize,
    }),
  );

  return {
    meta: prepared.meta,
    session,
    containerLength: prepared.container.length,
    symbolSize: options.symbolSize,
    sourcePacketCount: Math.max(
      1,
      Math.ceil(prepared.container.length / (options.symbolSize - 4)),
    ),
    packets,
    ...classification,
  };
}

export function raptorPacketKey(frame: OpticalFrame) {
  if (frame.payload.length < 4) throw new Error("RaptorQ payload ID is missing.");
  return `${frame.session}:${frame.payload[0]}:${frame.payload[1]}:${frame.payload[2]}:${frame.payload[3]}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function formatRate(bytesPerSecond: number) {
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}
