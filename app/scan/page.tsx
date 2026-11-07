import { localizedPageMetadata } from "../route-metadata";
import { ScannerClient } from "./scanner-client";

export const generateMetadata = () => localizedPageMetadata({
  title: "مسح نقل · QRFerry",
  description: "استقبل نقل ملفات متحرك عبر QR متسامح مع الفقد باستخدام كاميرتك.",
}, {
  title: "Scan a transfer · QRFerry",
  description: "Receive resilient animated QR file transfers using your camera.",
});

export default function ScanPage() {
  return (
    <>
      <ScannerClient />
    </>
  );
}
