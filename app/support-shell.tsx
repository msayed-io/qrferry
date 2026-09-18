"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowLeft,
  History,
  Download,
  ShieldCheck,
} from "lucide-react";
import { useI18n } from "./lang-provider";
import { WorkspaceHeader } from "./workspace-ui";
import "./support.css";

type SupportRoute = "history" | "offline" | "privacy";
const routes = [
  { id: "history", ar: "السجل", en: "History", Icon: History },
  { id: "offline", ar: "أوفلاين", en: "Offline", Icon: Download },
  { id: "privacy", ar: "الخصوصية", en: "Privacy", Icon: ShieldCheck },
] as const;

export function SupportShell({
  active,
  title,
  description,
  children,
}: {
  active: SupportRoute;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  const Back = lang === "ar" ? ArrowRight : ArrowLeft;
  return (
    <>
      <WorkspaceHeader active={active} />
      <main className="support-page" data-page={active}>
        <div className="support-toolbar">
          <Link href="/" className="support-home">
            <Back size={20} aria-hidden="true" />
            {lang === "ar" ? "الرجوع للرئيسية" : "Back to home"}
          </Link>
          <nav
            className="support-nav"
            aria-label={lang === "ar" ? "صفحات التطبيق" : "App pages"}
          >
            {routes.map(({ id, ar, en, Icon }) => (
              <Link
                key={id}
                href={`/${id}`}
                aria-current={active === id ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{lang === "ar" ? ar : en}</span>
              </Link>
            ))}
          </nav>
        </div>
        <header className="support-intro">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {children}
      </main>
    </>
  );
}
