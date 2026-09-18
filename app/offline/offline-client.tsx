"use client";

import { useState } from "react";
import { Check, Download, Package, WifiOff, AlertCircle } from "lucide-react";
import { useI18n } from "../lang-provider";
import { SupportShell } from "../support-shell";
import { buildOfflinePackage } from "@/lib/offline-package";

export function OfflineClient() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [state, setState] = useState<"idle" | "building" | "done">("idle");
  const [fileName, setFileName] = useState("");
  const [fileCount, setFileCount] = useState(0);
  const [error, setError] = useState("");
  const build = async () => {
    setState("building");
    setError("");
    try {
      const { blob, fileName, fileCount } = await buildOfflinePackage();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setFileName(fileName);
      setFileCount(fileCount);
      setState("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("idle");
    }
  };
  return (
    <SupportShell
      active="offline"
      title={t("offline.title")}
      description={
        ar
          ? "جهّز حزمة التطبيق قبل الانتقال إلى شبكة معزولة."
          : "Prepare an app package before moving to an isolated network."
      }
    >
      <div className="support-grid">
        <section className="support-card support-primary offline-package">
          <div className="support-card-heading">
            <h2>
              <Package size={24} aria-hidden="true" />
              {ar ? "حزمة التطبيق" : "App package"}
            </h2>
            <span className="support-count">ZIP</span>
          </div>
          <p>
            {ar
              ? "تجميع صفحات التطبيق والأصول المتاحة من النسخة الحالية في ملف واحد."
              : "Bundle app pages and available assets from the current version into one file."}
          </p>
          <div className="offline-contents">
            {(ar
              ? ["الواجهات", "الخطوط والأيقونات", "أصول التطبيق"]
              : ["Pages", "Fonts & icons", "App assets"]
            ).map((item) => (
              <span key={item}>
                <Check size={16} aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="support-button support-signal offline-download"
            disabled={state === "building"}
            aria-busy={state === "building"}
            onClick={() => void build()}
          >
            <Download size={20} aria-hidden="true" />
            {state === "building"
              ? t("offline.preparing")
              : t("offline.download")}
          </button>
          <div role="status" aria-live="polite">
            {state === "building" ? (
              <p>
                {ar
                  ? "اترك الصفحة مفتوحة أثناء التجهيز."
                  : "Keep this page open while the package is prepared."}
              </p>
            ) : state === "done" ? (
              <div className="support-notice">
                <Check size={20} aria-hidden="true" />
                <div>
                  <strong>
                    {ar
                      ? "تم تجهيز الحزمة وطلب تنزيلها."
                      : "Package prepared and download requested."}
                  </strong>
                  <p>
                    <bdi>{fileName}</bdi> · {fileCount} {ar ? "ملفًا" : "files"}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          {error && (
            <div className="support-error" role="alert">
              <AlertCircle size={20} aria-hidden="true" />
              <div>
                <strong>
                  {ar
                    ? "تعذّر تجهيز الحزمة. حاول مرة أخرى."
                    : "Could not prepare the package. Try again."}
                </strong>
                <p>{error}</p>
              </div>
            </div>
          )}
          <p className="support-caption">{t("offline.note")}</p>
        </section>
        <section className="support-card support-note">
          <h2>
            <WifiOff size={23} aria-hidden="true" />
            {ar ? "قبل الاستخدام دون إنترنت" : "Before going offline"}
          </h2>
          <ol className="support-steps">
            <li>
              {ar
                ? "حمّل الحزمة وانقلها إلى الجهاز المطلوب عبر USB."
                : "Download the package and move it to the target device via USB."}
            </li>
            <li>
              {ar
                ? "فك الضغط واتبع ملف READ-ME لتشغيل خادم محلي. جهّز اعتماديات الخادم قبل قطع الإنترنت."
                : "Unzip and follow READ-ME to run a local server. Install server dependencies before disconnecting."}
            </li>
            <li>
              {ar
                ? "للكاميرا: استخدم HTTPS أو localhost. عنوان HTTP لجهاز آخر لا يكفي عادةً."
                : "For camera access, use HTTPS or localhost. Another device’s HTTP address is usually insufficient."}
            </li>
          </ol>
          <p className="support-callout">
            {ar
              ? "النقل السريع في شبكة معزولة يحتاج خادم تسيير محليًا؛ النقل البصري لا يحتاج شبكة بعد تحميل التطبيق."
              : "Fast transfer in an isolated network needs local signaling; optical transfer needs no network once the app is loaded."}
          </p>
        </section>
      </div>
    </SupportShell>
  );
}
