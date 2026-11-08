"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { translate, type Lang } from "@/lib/i18n";
import { currentDeviceLanguage, subscribeDeviceLanguage } from "./device-environment";
import { isNativeDevice } from "@/lib/native-device";

type I18nContextValue = {
  lang: Lang;
  t: (key: string, params?: Record<string, string | number>) => string;
};
const I18nContext = createContext<I18nContextValue>({ lang: "en", t: key => key });
const subscribe = (notify: () => void) => {
  const unsubscribeNative=subscribeDeviceLanguage(notify);
  window.addEventListener("languagechange", notify);
  // Re-check after returning from device/browser settings, even if that
  // browser does not emit languagechange while the page is in the background.
  window.addEventListener("focus", notify);
  document.addEventListener("visibilitychange", notify);
  return () => {
    unsubscribeNative();
    window.removeEventListener("languagechange", notify);
    window.removeEventListener("focus", notify);
    document.removeEventListener("visibilitychange", notify);
  };
};
const getLanguage = currentDeviceLanguage;

export function LangProvider({ children, initialLang = "en" }: { children: ReactNode; initialLang?: Lang }) {
  const lang = useSyncExternalStore(subscribe, getLanguage, () => initialLang);
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    // Old manual preferences are intentionally not read, written or restored.
    if (!isNativeDevice()) document.documentElement.removeAttribute("data-theme");
  }, [lang]);
  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);
  const value = useMemo(() => ({ lang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export const useI18n = () => useContext(I18nContext);
