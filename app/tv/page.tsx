import type { Metadata } from "next";
import { TvClient } from "./tv-client";

export const metadata: Metadata = {
  title: "استقبال على التلفزيون · QRFerry",
  description: "استقبل ملفات من هاتفك على شاشة التلفزيون عبر الشبكة المحلية.",
};

export default function TvPage() {
  return <TvClient />;
}
