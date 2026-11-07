"use client";

import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "./lang-provider";
import { LiquidButton } from "./liquid-controls";
import { DesignIcon } from "./design-icons";

export type BridgeView = "pair" | "chat";
export const BridgeViewContext = createContext({
  connected: false,
  view: "pair" as BridgeView,
  setView: (_view: BridgeView) => { void _view; },
  connectionChanged: (_connected: boolean) => { void _connected; },
});
export const useBridgeView = () => useContext(BridgeViewContext);

export function Capsule({ tinted = false, large = false, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tinted?: boolean; large?: boolean }) {
  return <LiquidButton type="button" className={`glass cap ${tinted ? "tinted" : ""} ${large ? "lg" : ""} ${className}`} {...props} />;
}
export function CircleButton({ tinted = false, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tinted?: boolean }) {
  return <LiquidButton type="button" className={`glass circle ${tinted ? "tinted" : ""} ${className}`} {...props} />;
}
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function CameraCorners() {
  return <><b aria-hidden="true" /><b aria-hidden="true" /><b aria-hidden="true" /><b aria-hidden="true" /></>;
}
export function NetworkStatus() {
  const { lang } = useI18n();
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    queueMicrotask(update);
    addEventListener("online", update); addEventListener("offline", update);
    return () => { removeEventListener("online", update); removeEventListener("offline", update); };
  }, []);
  // navigator.onLine cannot prove Wi-Fi, shared LAN, internet access, or peer reachability.
  return <span role="status">{online === null ? (lang === "ar" ? "—" : "—") : online
    ? (lang === "ar" ? "الشبكة متاحة للجهاز · اتصال الطرف الآخر لم يُتحقق منه" : "Device is online · peer connectivity not yet verified")
    : (lang === "ar" ? "الجهاز دون اتصال بالشبكة" : "Device is offline")}</span>;
}
export function ThemeButton() {
  const { lang } = useI18n();
  const toggle = () => {
    const root = document.documentElement;
    const dark = (root.dataset.theme || (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light")) === "dark";
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("qrferry-theme", root.dataset.theme); } catch { /* preference persistence is optional */ }
  };
  return <CircleButton onClick={toggle} aria-label={lang === "ar" ? "المظهر" : "Appearance"}><DesignIcon name="mode" /></CircleButton>;
}
