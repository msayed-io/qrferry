import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { requestLanguage } from "./device-language";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const lang = requestLanguage((await headers()).get("accept-language"));
  const ar = lang === "ar";
  return {
    name: ar ? "QRFerry · نقل الملفات عبر الكاميرا" : "QRFerry · Files through your camera",
    short_name: "QRFerry",
    description:
      ar ? "أرسل واستقبل الملفات كبثّ أكواد QR متحرك متسامح مع الفقد." : "Send and receive files using resilient animated QR streams.",
    lang,
    dir: ar ? "rtl" : "ltr",
    start_url: "/scan",
    display: "standalone",
    background_color: "#F7F4F6",
    theme_color: "#F7F4F6",
    orientation: "portrait",
    categories: ["utilities", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    // المشاركة من أندرويد: اختيار ملف من أي تطبيق → «مشاركة عبر QRFerry»
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        files: [{ name: "file", accept: ["*/*"] }],
      },
    },
  };
}
