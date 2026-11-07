import { localizedPageMetadata } from "../route-metadata";
import { PrivacyClient } from "./privacy-client";
export const generateMetadata = () => localizedPageMetadata({
  title: "سياسة الخصوصية · QRFerry",
  description:
    "كيف يستخدم QRFerry الكاميرا والشبكة والتخزين المحلي لحماية ملفاتك.",
}, {
  title: "Privacy policy · QRFerry",
  description: "How QRFerry uses your camera, network and local storage.",
});
export default function PrivacyPage() {
  return <PrivacyClient />;
}
