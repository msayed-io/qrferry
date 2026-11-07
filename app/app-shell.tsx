"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { useI18n } from "./lang-provider";
import { DesignIcon } from "./design-icons";
import { BridgeViewContext, ThemeButton, CircleButton, type BridgeView } from "./design-system";
import { BridgeClient } from "./bridge/bridge-client";
import { NetworkIndicator } from "./network-indicator";
import { observeRims } from "./rim";

/** Only the mounted UI/session owner is retained. The transport and its authentication are unchanged. */
export function AppShell({ children }: { children: ReactNode }) {
  const { lang, setLang } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<BridgeView>("pair");
  const bridgeRoute = path === "/bridge" || path === "/pc";
  const connectedRef = useRef(false);
  const connectionChanged = useCallback((next: boolean) => {
    const changed = connectedRef.current !== next;
    connectedRef.current = next;
    setConnected(next);
    setView(next ? "chat" : "pair");
    // The session callback outlives route renders; read the live path, not a stale closure.
    // Only an actual connection/disconnection edge can move a different route to Pair/Chat.
    if (changed && !["/pc", "/bridge"].includes(window.location.pathname)) {
      router.push("/bridge");
    }
  }, [router]);
  const context = useMemo(() => ({ connected, view, setView, connectionChanged }), [connected, view, connectionChanged]);
  useEffect(observeRims, []);
  const active = bridgeRoute ? (connected && view === "chat" ? "chat" : "pair") : path === "/" ? "send" : path === "/scan" ? "scan" : null;
  const tabs = [
    { id: "send", path: "/", icon: "up", ar: "إرسال", en: "Send" },
    { id: "scan", path: "/scan", icon: "scan", ar: "مسح", en: "Scan" },
    { id: "pair", path: bridgeRoute ? path : "/bridge", icon: "link", ar: "ربط", en: "Pair" },
    ...(connected ? [{ id: "chat", path: bridgeRoute ? path : "/bridge", icon: "chat" as const, ar: "محادثة", en: "Chat" }] : []),
  ] as const;
  const navigate = (id: string, href: string) => {
    if (id === "pair" || id === "chat") setView(id);
    if (path !== href) router.push(href);
    window.scrollTo({ top: 0 });
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === "ArrowRight" ? (lang === "ar" ? -1 : 1) : event.key === "ArrowLeft" ? (lang === "ar" ? 1 : -1) : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : delta ? (index + delta + tabs.length) % tabs.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const tab = tabs[next];
    navigate(tab.id, tab.path);
    document.getElementById(`nav-${tab.id}`)?.focus();
  };
  return <BridgeViewContext.Provider value={context}>
    <div className={`wrap app-wrap ${active === "chat" ? "chat-wrap" : ""}`}>
      <header className="app-header">
        <Link className="brand" href="/" aria-label="QRFerry">
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3"/><rect x="17" y="3" width="10" height="10" rx="3"/><rect x="3" y="17" width="10" height="10" rx="3"/><rect x="17" y="17" width="10" height="10" rx="3" fill="var(--tint)" stroke="none"/></svg>
          QRFerry
        </Link>
        <div className="tools"><ThemeButton /><CircleButton aria-label={lang === "ar" ? "English" : "العربية"} onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{lang === "ar" ? "EN" : "ع"}</CircleButton></div>
      </header>
      <div id="route-content" hidden={bridgeRoute}>{children}</div>
      <div id="bridge-content" hidden={!bridgeRoute}><BridgeClient /></div>
      {active !== "chat" && <footer className="site-footer">
        <nav className="secondary-links" aria-label={lang === "ar" ? "صفحات التطبيق" : "App pages"}>
          <Link className="glass cap" href="/history">{lang === "ar" ? "السجل" : "History"}</Link>
          <Link className="glass cap" href="/offline">{lang === "ar" ? "أوفلاين" : "Offline"}</Link>
          <Link className="glass cap" href="/privacy">{lang === "ar" ? "الخصوصية" : "Privacy"}</Link>
        </nav>
        <details className="network-details"><summary>{lang === "ar" ? "نشاط الشبكة" : "Network activity"}</summary><NetworkIndicator /></details>
      </footer>}
    </div>
    <nav className="bottom-nav" aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}>
      <div className="glass tabs" role="tablist" aria-label={lang === "ar" ? "طريقة النقل" : "Transfer mode"}>
        {tabs.map((tab, index) => <button key={tab.id} id={`nav-${tab.id}`} className="tab" type="button" role="tab" aria-selected={active === tab.id} aria-controls={tab.id === "pair" || tab.id === "chat" ? "bridge-content" : "route-content"} tabIndex={active === tab.id || (active === null && index === 0) ? 0 : -1} onKeyDown={e => tabKey(e, index)} onClick={() => navigate(tab.id, tab.path)}><DesignIcon name={tab.icon} /><span>{lang === "ar" ? tab.ar : tab.en}</span></button>)}
      </div>
    </nav>
  </BridgeViewContext.Provider>;
}
