import type { Metadata } from "next";
import { AppHeader } from "./app-header";
import { SendClient } from "./send-client";

export const metadata: Metadata = {
  title: "إرسال ملف · QRFerry",
  description:
    "حوّل أي ملف إلى بثّ أكواد QR متحرك سريع وقابل للإصلاح، واستقبله بكاميرا هاتفك.",
};

export default function Home() {
  return (
    <>
      <AppHeader active="send" />
      <SendClient />
    </>
  );
}
