import {
  prepareZXingModule,
  readBarcodes,
} from "zxing-wasm/reader";
import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

let ready: Promise<unknown> | undefined;

export function prepareQrScanner() {
  if (!ready) {
    ready = Promise.resolve(
      prepareZXingModule({
        overrides: {
          locateFile: (path: string) =>
            path.endsWith(".wasm") ? zxingReaderWasmUrl : path,
        },
        equalityFn: Object.is,
        fireImmediately: true,
      }),
    );
  }
  return ready;
}

export async function scanRawQr(
  image: ImageData,
  robust: boolean,
): Promise<Uint8Array | null> {
  const results = await scanRawQrs(image, robust, 1);
  return results[0] ?? null;
}

export async function scanRawQrs(
  image: ImageData,
  robust: boolean,
  maxNumberOfSymbols = 2,
): Promise<Uint8Array[]> {
  await prepareQrScanner();
  const results = await readBarcodes(image, {
    formats: ["QRCode"],
    tryHarder: robust,
    tryRotate: false,
    tryInvert: false,
    tryDownscale: false,
    tryDenoise: false,
    binarizer: robust ? "LocalAverage" : "GlobalHistogram",
    maxNumberOfSymbols,
    textMode: "Plain",
  });
  return results
    .filter(
      (candidate) =>
      candidate.isValid &&
      candidate.symbology === "QRCode" &&
      candidate.bytes.length > 0,
    )
    .map((candidate) => new Uint8Array(candidate.bytes));
}
