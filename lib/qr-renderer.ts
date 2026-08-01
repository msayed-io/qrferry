import init, {
  QrRenderer,
  type InitOutput,
} from "@raptorqr/fast-qr-wasm";

const ECC_NUMBER = { L: 0, M: 1, Q: 2, H: 3 } as const;
let initPromise: Promise<InitOutput> | undefined;
let renderer: QrRenderer | undefined;

export async function renderRawQr(
  bytes: Uint8Array,
  version: number,
  ecc: keyof typeof ECC_NUMBER,
  scale: number,
) {
  if (!initPromise) initPromise = init();
  const wasm = await initPromise;
  if (!renderer) renderer = new QrRenderer();
  const side = renderer.render_rgba(bytes, version, ECC_NUMBER[ecc], scale);
  const length = side * side * 4;
  const view = new Uint8ClampedArray(
    wasm.memory.buffer,
    renderer.rgba_ptr(),
    length,
  );
  const copy = new Uint8ClampedArray(length);
  copy.set(view);
  return new ImageData(copy, side, side);
}
