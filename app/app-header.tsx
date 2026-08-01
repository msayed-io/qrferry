"use client";

import Link from "next/link";
import { useI18n } from "./lang-provider";

export function AppHeader({ active }: { active: "send" | "scan" }) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="site-header">
      <Link className="wordmark" href="/" aria-label="QRFerry الرئيسية">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>QRFerry</span>
      </Link>
      <nav className="mode-switch" aria-label="وضع النقل">
        <Link className={active === "send" ? "active" : ""} href="/">
          {t("nav.send")}
        </Link>
        <Link className={active === "scan" ? "active" : ""} href="/scan">
          {t("nav.scan")}
        </Link>
      </nav>
      <div className="header-tools">
        <span className="local-badge">
          <span aria-hidden="true" />
          {t("app.tagline")}
        </span>
        <button
          type="button"
          className="lang-switch"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          aria-label="Switch language / تبديل اللغة"
        >
          {lang === "ar" ? "EN" : "ع"}
        </button>
      </div>
    </header>
  );
}
