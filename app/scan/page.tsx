import type { Metadata } from "next";
import { ScannerClient } from "./scanner-client";

export const metadata: Metadata = {
  title: "مسح نقل · QRFerry",
  description: "استقبل نقل ملفات متحرك عبر QR متسامح مع الفقد باستخدام كاميرتك.",
};

export default function ScanPage() {
  return (
    <>
      <ScannerClient />
    </>
  );
}
