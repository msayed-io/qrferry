"use client";

import { useState } from "react";
import { useI18n } from "../lang-provider";
import { buildOfflinePackage } from "@/lib/offline-package";

export function OfflineClient() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "building" | "done">("idle");
  const [fileName, setFileName] = useState("");
  const [fileCount, setFileCount] = useState(0);

  const build = async () => {
    setState("building");
    try {
      const { blob, fileName, fileCount } = await buildOfflinePackage();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setFileName(fileName);
      setFileCount(fileCount);
      setState("done");
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setState("idle");
    }
  };

  return (
    <main className="offline-page">
      <p className="eyebrow">AIR-GAPPED</p>
      <h1>{t("offline.title")}</h1>
      <p className="offline-desc">{t("offline.desc")}</p>

      <button
        type="button"
        className="primary-action offline-download"
        disabled={state === "building"}
        onClick={() => void build()}
      >
        <span aria-hidden="true">⬇</span>
        {state === "building" ? t("offline.preparing") : t("offline.download")}
      </button>

      {state === "done" ? (
        <p className="resume-note" role="status">
          ✓ {fileName} — {fileCount} ملفاً في الحزمة
        </p>
      ) : null}

      <section className="offline-how">
        <h2>{t("offline.howTitle")}</h2>
        <ol>
          <li>{t("offline.how1")}</li>
          <li>{t("offline.how2")}</li>
          <li>{t("offline.how3")}</li>
        </ol>
        <p className="offline-note">{t("offline.note")}</p>
      </section>
    </main>
  );
}
