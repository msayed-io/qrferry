"use client";

import Link from "next/link";
import { useI18n } from "./lang-provider";

/** Presentation for Next's existing 404 handler, not a new application route. */
export default function NotFound() {
  const { lang } = useI18n();
  return <main className="transfer-page">
    <section className="workspace-intro"><h1>404</h1><p>{lang === "ar" ? "هذه الصفحة غير موجودة." : "This page could not be found."}</p></section>
    <section className="card act2"><Link href="/" className="glass cap">{lang === "ar" ? "الرجوع للرئيسية" : "Back to home"}</Link></section>
  </main>;
}
