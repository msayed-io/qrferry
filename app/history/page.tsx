import type { Metadata } from "next";
import { HistoryClient } from "./history-client";

export const metadata: Metadata = {
  title: "سجل النقل · QRFerry",
  description: "سجل النقولات المحلي على جهازك.",
};

export default function HistoryPage() {
  return (
    <>
      <HistoryClient />
    </>
  );
}
