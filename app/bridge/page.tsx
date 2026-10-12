import type { Metadata } from "next";
import { WorkspaceHeader } from "../workspace-ui";
import { BridgeClient } from "./bridge-client";
import "./bridge.css";

export const metadata: Metadata = {
  title: "جسر النقل الذكي · QRFerry",
  description:
    "اربط هاتفك بالكمبيوتر بمسح رمز واحد، ثم أرسل رسائل وملفات في الاتجاهين مباشرةً بينهما دون رفعها إلى أي خادم.",
};

export default function BridgePage() {
  return (
    <>
      <WorkspaceHeader active="bridge" />
      <BridgeClient />
    </>
  );
}
