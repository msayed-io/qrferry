"use client";

import { Menu } from "glisse";
import { History, ShieldCheck } from "lucide-react";
import { useI18n } from "./lang-provider";

/** Native Glisse Menu: its morph, plate, scrubbing, keyboard and focus behavior. */
export function AppMenu({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return <Menu
    key={lang}
    className="app-menu"
    aria-label={ar ? "قائمة التطبيق" : "App menu"}
    align={ar ? "start" : "end"}
    items={[
      { label: ar ? "السجل" : "History", icon: <History aria-hidden />, onSelect: () => onNavigate("/history") },
      { label: ar ? "الخصوصية" : "Privacy", icon: <ShieldCheck aria-hidden />, onSelect: () => onNavigate("/privacy") },
    ]}
  />;
}
