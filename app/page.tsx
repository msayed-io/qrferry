import { localizedPageMetadata } from "./route-metadata";
import { SendClient } from "./send-client";

export const generateMetadata = () => localizedPageMetadata({
  title: "إرسال ملف · QRFerry",
  description:
    "حوّل أي ملف إلى بثّ أكواد QR متحرك سريع وقابل للإصلاح، واستقبله بكاميرا هاتفك.",
}, {
  title: "Send a file · QRFerry",
  description: "Turn files into a resilient animated QR stream and receive them with your phone camera.",
});

export default function Home() {
  return (
    <>
      <SendClient />
    </>
  );
}
