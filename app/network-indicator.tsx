"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./lang-provider";

/**
 * مؤشر «صفر شبكة»: يراقب طلبات الشبكة (fetch و XHR) أثناء الجلسة ويعرض
 * شارة دائمة تطمئن المستخدم أن التطبيق لا يرسل أي شيء.
 */
export function NetworkIndicator() {
  const { t } = useI18n();
  const [state, setState] = useState<"quiet" | "active">("quiet");

  useEffect(() => {
    let activeTimer: number | undefined;

    const markActive = () => {
      setState("active");
      if (activeTimer) window.clearTimeout(activeTimer);
      activeTimer = window.setTimeout(() => setState("quiet"), 3000);
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = ((...args: Parameters<typeof fetch>) => {
      markActive();
      return originalFetch(...args);
    }) as typeof fetch;

    const xhrPrototype = XMLHttpRequest.prototype as unknown as {
      open: XMLHttpRequest["open"];
      send: XMLHttpRequest["send"];
    };
    const originalSend = xhrPrototype.send;
    const originalOpen = xhrPrototype.open;
    xhrPrototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>) {
      markActive();
      return originalSend.apply(this, args as never);
    };
    // إبقاء مرجع open سليماً دون مراقبة (المراقبة عند send)
    void originalOpen;

    return () => {
      window.fetch = originalFetch;
      xhrPrototype.send = originalSend;
      if (activeTimer) window.clearTimeout(activeTimer);
    };
  }, []);

  const label = state === "quiet" ? t("network.zero") : t("network.active");

  return (
    <span
      className={`network-indicator ${state === "quiet" ? "quiet" : "active"}`}
      title={label}
      aria-label={label}
    >
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
