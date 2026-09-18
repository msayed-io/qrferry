import type { Metadata } from "next";
import { PrivacyClient } from "./privacy-client";
export const metadata: Metadata = {
  title: "سياسة الخصوصية · QRFerry",
  description:
    "كيف يستخدم QRFerry الكاميرا والشبكة والتخزين المحلي لحماية ملفاتك.",
};
export default function PrivacyPage() {
  return <PrivacyClient />;
}
