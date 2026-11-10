"use client";

import { Button, Glass } from "glisse";
import { BackChevron } from "./progressive-blur";
import { useRouter } from "./router";
import type { ReactNode } from "react";
import { useI18n } from "./lang-provider";
import { useSupportReturn } from "./support-navigation";
import "./support.css";

type SupportRoute = "history" | "privacy";
const names = {
  history: { ar: "السجل", en: "History" },
  privacy: { ar: "الخصوصية", en: "Privacy" },
};

export function SupportShell({ active, title, description, children }: {
  active: SupportRoute;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  const router = useRouter();
  const returnPath = useSupportReturn();
  return <main className="support-page" data-page={active}>
    <header className="support-toolbar">
      <Button
        className="support-exit"
        icon={<BackChevron />}
        aria-label={lang === "ar" ? "الرجوع إلى التطبيق" : "Back to app"}
        onClick={() => router.push(returnPath)}
      />
      <Glass className="support-title">
        <h1 aria-label={title}>{names[active][lang]}</h1>
      </Glass>
    </header>
    <p className="support-description">{description}</p>
    {children}
  </main>;
}
