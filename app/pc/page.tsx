import type { Metadata } from "next";
import { BridgeClient } from "./pc-client";

export const metadata: Metadata = {
  title: "جسر الكمبيوتر · QRFerry",
  description:
    "اربط هاتفك بالكمبيوتر بمسح رمز واحد، ثم أرسل رسائل وملفات في الاتجاهين مباشرةً بينهما دون رفعها إلى أي خادم.",
};

export default function PcPage() {
  return <BridgeClient />;
}
