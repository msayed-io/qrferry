import type { Metadata } from "next";
import { headers } from "next/headers";
import { requestLanguage } from "./device-language";

export async function localizedPageMetadata(ar: { title: string; description: string }, en: { title: string; description: string }): Promise<Metadata> {
  return requestLanguage((await headers()).get("accept-language")) === "ar" ? ar : en;
}
