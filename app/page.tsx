import type { Metadata } from "next";
import { WorkspaceHeader } from "./workspace-ui";
import { SendClient } from "./send-client";

export const metadata: Metadata = {
  title: "إرسال ملف · QRFerry",
  description:
    "حوّل أي ملف إلى بثّ أكواد QR متحرك سريع وقابل للإصلاح، واستقبله بكاميرا هاتفك.",
};

export default function Home() {
  return (
    <>
      <WorkspaceHeader active="send" />
      <SendClient />
    </>
  );
}
