import type { Metadata } from "next";
import { WorkspaceHeader } from "../workspace-ui";
import { BridgeClient } from "./pc-client";

export const metadata: Metadata = {
  title: "جسر الكمبيوتر · QRFerry",
  description:
    "اربط هاتفك بالكمبيوتر بمسح رمز واحد، ثم أرسل رسائل وملفات في الاتجاهين مباشرةً بينهما دون رفعها إلى أي خادم.",
};

export default function PcPage() {
  return (
    <>
      <WorkspaceHeader active="pc" />
      <BridgeClient />
    </>
  );
}
