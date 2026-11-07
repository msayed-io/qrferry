import { localizedPageMetadata } from "../route-metadata";
import { HistoryClient } from "./history-client";

export const generateMetadata = () => localizedPageMetadata({
  title: "سجل النقل · QRFerry",
  description: "سجل النقولات المحلي على جهازك.",
}, {
  title: "Transfer history · QRFerry",
  description: "Your local transfer history on this device.",
});

export default function HistoryPage() {
  return (
    <>
      <HistoryClient />
    </>
  );
}
