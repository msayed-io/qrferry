import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QRFerry · نقل الملفات عبر الكاميرا",
    short_name: "QRFerry",
    description:
      "أرسل واستقبل الملفات كبثّ أكواد QR متحرك متسامح مع الفقد.",
    lang: "ar",
    dir: "rtl",
    start_url: "/scan",
    display: "standalone",
    background_color: "#f4f1ea",
    theme_color: "#111820",
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
