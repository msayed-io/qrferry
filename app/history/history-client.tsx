"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../lang-provider";
import { Check, Lock, PenLine } from "lucide-react";
import {
  clearHistory,
  getHistoryEntries,
  type HistoryEntry,
} from "@/lib/history-store";
import { formatBytes } from "@/lib/optical-transfer";

export function HistoryClient() {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHistoryEntries(50).then((list) => {
      if (cancelled) return;
      setEntries(list);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onClear = async () => {
    await clearHistory();
    setEntries([]);
  };

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", {
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <main className="history-page">
      <p className="eyebrow">{t("history.localNote")}</p>
      <h1>{t("history.title")}</h1>

      {!loaded ? (
        <p className="history-empty">…</p>
      ) : entries.length === 0 ? (
        <p className="history-empty">{t("history.empty")}</p>
      ) : (
        <>
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>{t("history.name")}</th>
                  <th>{t("history.size")}</th>
                  <th>{t("history.files")}</th>
                  <th>{t("history.encrypted")}</th>
                  <th>{t("history.signed")}</th>
                  <th>{t("history.verified")}</th>
                  <th>{t("history.time")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td title={entry.name}>{entry.name}</td>
                    <td>{formatBytes(entry.size)}</td>
                    <td>{entry.fileCount}</td>
                    <td>{entry.encrypted ? <Lock size={13} aria-hidden="true" /> : "—"}</td>
                    <td>{entry.signed ? <PenLine size={13} aria-hidden="true" /> : "—"}</td>
                    <td>{entry.verified ? <Check size={13} aria-hidden="true" /> : "—"}</td>
                    <td>{formatTime(entry.time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="link-action danger" onClick={() => void onClear()}>
            {t("history.clear")}
          </button>
        </>
      )}
    </main>
  );
}
