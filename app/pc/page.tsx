import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "جسر الكمبيوتر · QRFerry",
  description:
    "اربط هاتفك بالكمبيوتر بمسح رمز واحد، ثم أرسل رسائل وملفات في الاتجاهين مباشرةً بينهما دون رفعها إلى أي خادم.",
};

// The persistent AppShell owns the real bridge session across tab navigation.
export default function PcPage() {
  return null;
}
