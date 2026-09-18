import type { Metadata } from "next";
import { OfflineClient } from "./offline-client";

export const metadata: Metadata = {
  title: "حزمة أوفلاين · QRFerry",
  description: "حمّل QRFerry كاملاً للعمل داخل شبكة معزولة عن الإنترنت.",
};

export default function OfflinePage() {
  return (
    <>
      <OfflineClient />
    </>
  );
}
