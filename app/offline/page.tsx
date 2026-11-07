import { localizedPageMetadata } from "../route-metadata";
import { OfflineClient } from "./offline-client";

export const generateMetadata = () => localizedPageMetadata({
  title: "حزمة أوفلاين · QRFerry",
  description: "حمّل QRFerry كاملاً للعمل داخل شبكة معزولة عن الإنترنت.",
}, {
  title: "Offline package · QRFerry",
  description: "Prepare QRFerry for use on a network isolated from the internet.",
});

export default function OfflinePage() {
  return (
    <>
      <OfflineClient />
    </>
  );
}
