import { mkdirSync, writeFileSync } from "node:fs";
import { buildTransferFixture } from "../e2e/helpers/transfer-fixture";
const original = "QRFerry Android worker verified";
const fixture = await buildTransferFixture({
  bytes: new TextEncoder().encode(original),
  filename: "native-worker.txt",
});
const directory = "android/app/src/androidTest/assets";
mkdirSync(directory, { recursive: true });
writeFileSync(
  directory + "/decoder-fixture.json",
  JSON.stringify({
    original,
    frames: fixture.frames.map((frame) => ({
      n: frame.n,
      data: Buffer.from(frame.data).toString("base64"),
    })),
  }),
);
console.log("Generated native-test-only real optical QR fixture.");
