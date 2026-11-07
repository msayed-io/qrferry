import { localizedPageMetadata } from "../route-metadata";

export const generateMetadata = () => localizedPageMetadata({
  title: "جسر الكمبيوتر · QRFerry",
  description:
    "اربط هاتفك بالكمبيوتر بمسح رمز واحد، ثم أرسل رسائل وملفات في الاتجاهين مباشرةً بينهما دون رفعها إلى أي خادم.",
}, {
  title: "Computer bridge · QRFerry",
  description: "Pair your phone and computer, then send messages and files directly between them.",
});

// The persistent AppShell owns the real bridge session across tab navigation.
export default function PcPage() {
  return null;
}
