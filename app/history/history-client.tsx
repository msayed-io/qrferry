"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Check,
  Lock,
  PenLine,
  History,
  Trash2,
  ScanLine,
  HardDrive,
} from "lucide-react";
import { useI18n } from "../lang-provider";
import { SupportShell } from "../support-shell";
import { WorkspaceDialog } from "../workspace-ui";
import {
  clearHistory,
  getHistoryEntries,
  type HistoryEntry,
} from "@/lib/history-store";
import { formatBytes } from "@/lib/optical-transfer";

export function HistoryClient() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getHistoryEntries(50).then((list) => {
      if (!cancelled) {
        setEntries(list);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const onClear = async () => {
    setClearing(true);
    try {
      await clearHistory();
      setEntries(await getHistoryEntries(50));
      setConfirm(false);
    } finally {
      setClearing(false);
    }
  };
  const formatTime = (time: number) =>
    new Date(time).toLocaleString(ar ? "ar-EG" : "en-US", {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <SupportShell
      active="history"
      title={t("history.title")}
      description={t("history.localNote")}
    >
      <div className="support-grid">
        <section
          className="support-card support-primary"
          aria-label={ar ? "النقولات الأخيرة" : "Recent transfers"}
        >
          <div className="support-card-heading">
            <h2>
              <History size={23} aria-hidden="true" />
              {ar ? "النقولات الأخيرة" : "Recent transfers"}
            </h2>
            {loaded && (
              <span
                className="support-count"
                aria-label={ar ? "عدد السجلات المعروضة" : "Displayed entries"}
              >
                {entries.length}
              </span>
            )}
          </div>
          {!loaded ? (
            <p role="status" className="support-empty">
              {ar ? "جارٍ تحميل السجل…" : "Loading history…"}
            </p>
          ) : entries.length === 0 ? (
            <div className="support-empty">
              <History size={40} aria-hidden="true" />
              <h3>{t("history.empty")}</h3>
              <p>
                {ar
                  ? "ستظهر هنا تفاصيل النقولات المستلمة."
                  : "Details of received transfers will appear here."}
              </p>
              <Link className="support-button support-signal" href="/scan">
                <ScanLine size={19} aria-hidden="true" />
                {ar ? "استقبال ملفات" : "Receive files"}
              </Link>
            </div>
          ) : (
            <>
              <ol className="history-list">
                {entries.map((entry) => (
                  <li className="history-item" key={entry.id}>
                    <h3 dir="auto">{entry.name}</h3>
                    <dl>
                      <div>
                        <dt>{t("history.size")}</dt>
                        <dd>{formatBytes(entry.size)}</dd>
                      </div>
                      <div>
                        <dt>{t("history.files")}</dt>
                        <dd>{entry.fileCount}</dd>
                      </div>
                      <div className="history-time">
                        <dt>{t("history.time")}</dt>
                        <dd>
                          <time dateTime={new Date(entry.time).toISOString()}>
                            {formatTime(entry.time)}
                          </time>
                        </dd>
                      </div>
                    </dl>
                    <div className="history-badges">
                      <span data-active={entry.encrypted}>
                        <Lock size={15} aria-hidden="true" />
                        {entry.encrypted
                          ? t("history.encrypted")
                          : ar
                            ? "بدون تشفير"
                            : "Not encrypted"}
                      </span>
                      <span data-active={entry.signed}>
                        <PenLine size={15} aria-hidden="true" />
                        {entry.signed
                          ? t("history.signed")
                          : ar
                            ? "غير موقّع"
                            : "Not signed"}
                      </span>
                      <span data-active={entry.verified}>
                        <Check size={15} aria-hidden="true" />
                        {entry.verified
                          ? t("history.verified")
                          : ar
                            ? "غير متحقّق"
                            : "Not verified"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="support-card-footer">
                <button
                  className="support-button support-danger"
                  onClick={() => setConfirm(true)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                  {t("history.clear")}
                </button>
              </div>
            </>
          )}
        </section>
        <aside className="support-card support-note">
          <HardDrive size={26} aria-hidden="true" />
          <h2>{ar ? "على هذا المتصفح فقط" : "Only in this browser"}</h2>
          <p>
            {ar
              ? "السجل يعرض الأسماء والأحجام وحالة النقل، وليس نسخة من الملفات."
              : "History lists names, sizes and transfer status, not copies of the files."}
          </p>
          <p>
            {ar
              ? "مسح السجل لا يحذف تنزيلاتك أو الملفات المحفوظة في مكتبة التلفزيون."
              : "Clearing history does not delete downloads or files saved in the TV library."}
          </p>
        </aside>
      </div>
      {confirm && (
        <WorkspaceDialog
          title={ar ? "مسح السجل؟" : "Clear history?"}
          onClose={() => {
            if (!clearing) setConfirm(false);
          }}
        >
          <h3>{ar ? "مسح السجل؟" : "Clear history?"}</h3>
          <p>
            {ar
              ? "سيُحذف سجل النقل من هذا المتصفح. لا يمكن التراجع عن هذه الخطوة، ولن تُحذف ملفاتك."
              : "Transfer history will be removed from this browser. This cannot be undone; your files will not be deleted."}
          </p>
          <div className="support-dialog-actions">
            <button
              className="support-button"
              disabled={clearing}
              onClick={() => setConfirm(false)}
            >
              {ar ? "إلغاء" : "Cancel"}
            </button>
            <button
              className="support-button support-danger"
              disabled={clearing}
              onClick={() => void onClear()}
            >
              {clearing
                ? ar
                  ? "جارٍ المسح…"
                  : "Clearing…"
                : ar
                  ? "تأكيد المسح"
                  : "Confirm clear"}
            </button>
          </div>
        </WorkspaceDialog>
      )}
    </SupportShell>
  );
}
