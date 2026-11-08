import { useEffect } from "react";
import { useI18n } from "./lang-provider";
import { usePathname } from "./router";
const titles: Record<string, [string, string]> = {
  "/": ["إرسال", "Send"],
  "/scan": ["مسح", "Scan"],
  "/bridge": ["ربط ومحادثة", "Pair and chat"],
  "/pc": ["ربط ومحادثة", "Pair and chat"],
  "/tv": ["استقبال الشاشة", "Screen receiver"],
  "/history": ["السجل", "History"],
  "/privacy": ["الخصوصية", "Privacy"],
  "/share": ["مشاركة الملفات", "Share files"],
};
export function PageMetadata() {
  const { lang } = useI18n();
  const path = usePathname();
  useEffect(() => {
    const title = titles[path] ?? ["الصفحة غير موجودة", "Page not found"];
    document.title = `${title[lang === "ar" ? 0 : 1]} · QRFerry`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        lang === "ar"
          ? "نقل الملفات عبر QR أو اتصال مباشر مشفّر بين جهازين."
          : "Transfer files with QR or an encrypted direct connection between two devices.",
      );
    const query = matchMedia("(prefers-color-scheme:dark)");
    const update = () => {
      const theme = document.documentElement.dataset.theme;
      const dark = theme ? theme === "dark" : query.matches;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#121014" : "#F7F4F6");
    };
    update();
    query.addEventListener("change", update);
    window.addEventListener("qrferry-device-preferences", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("qrferry-device-preferences", update);
    };
  }, [lang, path]);
  return null;
}
