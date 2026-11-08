export type ReceiverMeta = {
  session: number;
  containerLength: number;
  originalSize: number;
  compressed: boolean;
  symbolSize: number;
  sourcePacketCount: number;
};
export type ScanSnapshot = {
  reads: number;
  accepted: number;
  bad: number;
  resumed: number;
  incoming?: ReceiverMeta;
  complete: boolean;
  guidance:
    | "locked"
    | "duplicate"
    | "different"
    | "badFrame"
    | "oldSender"
    | "lockedSymbol"
    | "highDensity";
};
export type ScanResult = {
  snapshot: ScanSnapshot;
  texts: string[];
  decoded: number;
  decodeMs: number;
  raw?: Uint8Array[];
};
export type RecoveryResult =
  | { passwordRequired: true }
  | {
      passwordRequired: false;
      files: Array<{ name: string; mime: string; bytes: Uint8Array }>;
      burnAfterReading: boolean;
      signed: boolean;
      signerName: string | null;
      publicKey: Uint8Array | null;
      signatureValid: boolean;
      encrypted: boolean;
      originalSize: number;
    };
export type ScanRequest =
  | { type: "prepare" | "flush" | "discard" }
  | { type: "recover"; password?: string }
  | { type: "frame"; bytes: ArrayBuffer }
  | {
      type: "scan";
      pixels: ArrayBuffer;
      width: number;
      height: number;
      robust: boolean;
      count: number;
      rawOnly: boolean;
      purpose: "qr" | "password" | "pubkey";
    };
