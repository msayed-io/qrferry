import assert from "node:assert/strict";
import test from "node:test";
import { deviceLanguage, requestLanguage } from "../app/device-language";
for (const [input, expected] of [
  [["ar-EG", "en-US"], "ar"], [["en-GB", "ar"], "en"], [["fr-FR", "ar-SA"], "ar"],
  [["de-DE", "fr"], "en"], [["AR_eg"], "ar"], [[], "en"],
] as const) test(`device locale ${input.join(",") || "empty"}`, () => assert.equal(deviceLanguage(input), expected));
for (const [input, expected] of [
  ["en-US;q=.3,ar-EG;q=.9", "ar"], ["ar;q=0,en;q=.5", "en"], ["fr,ar;q=.8", "ar"],
  ["ar;q=NaN,en", "en"], ["en;q=.8,ar;q=.8", "en"], [null, "en"],
] as const) test(`HTTP locale ${input}`, () => assert.equal(requestLanguage(input), expected));
