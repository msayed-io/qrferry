import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import "glisse/styles.css";
import "../app/globals.css";
import "../app/workspace.css";
import "../app/support.css";
import "../app/bridge/bridge.css";
import "../app/liquid-controls.css";
import "../app/floating-chrome.css";
import { AppShell } from "../app/app-shell";
import { LangProvider, useI18n } from "../app/lang-provider";
import { PwaRegister } from "../app/pwa-register";
import { RouteErrorBoundary } from "../app/global-error";
import { PageMetadata } from "../app/page-metadata";
import { NativeShareReceiver } from "../app/native-share-receiver";
import { initializeDeviceEnvironment } from "../app/device-environment";
import { usePathname, AppLink } from "../app/router";
import { LocalPage, SendPage, ScanPage, HistoryPage, PrivacyPage, TvPage } from "../app/route-pages";
const SendClient = SendPage.View;
const ScannerClient = ScanPage.View;
const HistoryClient = HistoryPage.View;
const PrivacyClient = PrivacyPage.View;
const TvClient = TvPage.View;

function RouteContent() {
  const path = usePathname();
  const { lang } = useI18n();
  const ar = lang === "ar";
  if (["/local", "/local/send", "/local/receive", "/local/scan", "/local/session"].includes(path)) return <LocalPage.View />;
  if (path === "/") return <SendClient />;
  if (path === "/scan") return <ScannerClient />;
  if (path === "/history") return <HistoryClient />;
  if (path === "/privacy") return <PrivacyClient />;
  if (path === "/tv") return <TvClient />;
  if (path === "/bridge" || path === "/pc") return null;
  if (path === "/share")
    return (
      <section className="card">
        <h1>{ar ? "مشاركة الملفات" : "Share files"}</h1>
        <p role="alert">
          {location.search
            ? ar
              ? "لم تُستورد المشاركة. اختر حتى 3 ملفات، بإجمالي 512 ميجابايت، وتأكد من توفر مساحة تخزين."
              : "The share was not imported. Choose up to 3 files, totaling 512 MiB, and ensure storage is available."
            : ar
              ? "للمشاركة من تطبيق آخر، ثبّت QRFerry وافتحه مرة واحدة أولاً. أو اختر الملفات من صفحة الإرسال."
              : "To share from another app, install QRFerry and open it once first. Alternatively, choose files on Send."}
        </p>
        <AppLink href="/">{ar ? "الإرسال" : "Send"}</AppLink>
      </section>
    );
  return (
    <section className="card">
      <h1>{ar ? "404 — الصفحة غير موجودة" : "404 — Page not found"}</h1>
      <AppLink href="/">{ar ? "العودة إلى الإرسال" : "Back to Send"}</AppLink>
    </section>
  );
}
function App() {
  return (
    <LangProvider>
      <PwaRegister />
      <PageMetadata />
      <NativeShareReceiver />
      <RouteErrorBoundary>
        <AppShell>
          <RouteErrorBoundary>
            <Suspense
              fallback={
                <div className="route-loading" role="status" aria-live="polite">
                  …
                </div>
              }
            >
              <RouteContent />
            </Suspense>
          </RouteErrorBoundary>
        </AppShell>
      </RouteErrorBoundary>
    </LangProvider>
  );
}
// Android resolves actual Configuration before the first React render. Browser
// execution does not wait for a native bridge or a network resource.
void initializeDeviceEnvironment()
  .catch((error) => console.warn("Device settings unavailable", error))
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
