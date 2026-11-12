"use client";


import { AppLink, usePathname, usePendingPathname, useRouter } from "./router";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "./lang-provider";
import { LiquidChoices } from "./liquid-controls";
import { DesignIcon } from "./design-icons";
import { BridgeViewContext, type BridgeView } from "./design-system";
import { BridgePage } from "./route-pages";
const BridgeClient = BridgePage.View;
import { ProfileButton, useProfile } from "./local/radar-view";
import { SupportReturnContext, SUPPORT_ROUTES } from "./support-navigation";
import { RouteErrorBoundary } from "./global-error";
import { ProgressiveBlur } from "./progressive-blur";
import { localSupported } from "../lib/native-local";
import { ChevronDown } from "lucide-react";
import { observeRims } from "./rim";

/** Only the mounted UI/session owner is retained. The transport and its authentication are unchanged. */
export function AppShell({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  const path = usePathname();
  const pendingPath = usePendingPathname();
  const router = useRouter();
  const localRoute = path === "/local" || path.startsWith("/local/");
  const standalone = SUPPORT_ROUTES.includes(path) || localRoute;
  const [returnPath, setReturnPath] = useState("/");
  // The profile entry replaced the menu in the header: same round glass, but the
  // user's own picture, and one tap opens the profile screen.
  const [headerProfile] = useProfile("User");
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<BridgeView>("pair");
  const bridgeRoute = path === "/bridge" || path === "/pc";
  const [bridgeMounted, setBridgeMounted] = useState(bridgeRoute);
  useEffect(() => {
    if (bridgeRoute) setBridgeMounted(true);
  }, [bridgeRoute]);
  const connectedRef = useRef(false);
  const connectionChanged = useCallback((next: boolean) => {
    const changed = connectedRef.current !== next;
    connectedRef.current = next;
    if (!changed) return; // Repeated status notifications must not override a user-selected tab.
    setConnected(next);
    setView(next ? "chat" : "pair");
    // An asynchronous network edge must never steal a newer explicit route choice.
    // On Pair itself, switching to Chat remains automatic; other routes stay put.
  }, []);
  const context = useMemo(() => ({ connected, view, setView, connectionChanged }), [connected, view, connectionChanged]);
  useEffect(observeRims, []);
  const immersiveChat = bridgeRoute && connected && view === "chat";
  const selectionPath = pendingPath ?? path;
  const selectionBridge = selectionPath === "/bridge" || selectionPath === "/pc";
  const active = selectionBridge ? (connected && view === "chat" ? "chat" : "pair") : selectionPath === "/" ? "send" : selectionPath === "/scan" ? "scan" : null;
  const tabs = [
    { id: "send", path: "/", icon: "up", ar: "إرسال", en: "Send" },
    { id: "scan", path: "/scan", icon: "scan", ar: "مسح", en: "Scan" },
    { id: "pair", path: bridgeRoute ? path : "/bridge", icon: "link", ar: "ربط", en: "Pair" },
    ...(connected ? [{ id: "chat", path: bridgeRoute ? path : "/bridge", icon: "chat" as const, ar: "محادثة", en: "Chat" }] : []),
  ] as const;
  const navigate = (id: string, href: string) => {
    if (id === "pair" || id === "chat") setView(id);
    router.push(href);
  };
  return <BridgeViewContext.Provider value={context}><SupportReturnContext.Provider value={returnPath}>
    <ProgressiveBlur />
    <div className={`wrap app-wrap ${standalone ? "standalone-wrap" : ""} ${immersiveChat ? "chat-wrap" : ""}`}>
      {!standalone && !immersiveChat && <header className="app-header">
        <div className="brand-group"><AppLink className="brand" href={localSupported() ? "/local" : "/"} aria-label="QRFerry">
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3"/><rect x="17" y="3" width="10" height="10" rx="3"/><rect x="3" y="17" width="10" height="10" rx="3"/><rect x="17" y="17" width="10" height="10" rx="3" fill="var(--tint)" stroke="none"/></svg>
          QRFerry
        </AppLink>{localSupported() && <button type="button" className="brand-mode" onClick={() => router.push("/local")} aria-label={lang === "ar" ? "فتح النقل المحلي بين هواتف Android" : "Open local Android transfer"}><ChevronDown size={18}/></button>}</div>
        <ProfileButton profile={headerProfile} label={lang === "ar" ? "ملفي الشخصي" : "My profile"} onOpen={() => { setReturnPath(path); router.push("/local/profile"); }} />
      </header>}
      <div id="route-content" hidden={bridgeRoute}>{children}</div>
      {(bridgeMounted || bridgeRoute) && <div id="bridge-content" hidden={!bridgeRoute}><RouteErrorBoundary><Suspense fallback={<div role="status">…</div>}><BridgeClient /></Suspense></RouteErrorBoundary></div>}
    </div>
    {!standalone && !immersiveChat && <nav className="bottom-nav" aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}>
      <LiquidChoices
        kind="navigation"
        label={lang === "ar" ? "طريقة النقل" : "Transfer mode"}
        value={active}
        items={tabs.map(tab => ({
          value: tab.id,
          label: lang === "ar" ? tab.ar : tab.en,
          icon: <DesignIcon name={tab.icon} />,
          controlId: `nav-${tab.id}`,
          controls: tab.id === "pair" || tab.id === "chat" ? "bridge-content" : "route-content",
        }))}
        onValueChange={id => {
          const tab = tabs.find(tab => tab.id === id);
          if (tab) navigate(tab.id, tab.path);
        }}
      />
    </nav>}
  </SupportReturnContext.Provider></BridgeViewContext.Provider>;
}
