"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ScanLine, Tv, ChevronDown, X } from "lucide-react";
import { useI18n } from "./lang-provider";
import "./workspace.css";

export const WORKSPACE_VERSION = "QRFERRY-UI-7";

export function WorkspaceHeader({
  active,
}: {
  active: "send" | "scan" | "history" | "offline" | "privacy";
}) {
  const { t, lang, setLang } = useI18n();
  useEffect(() => {
    document.documentElement.classList.add("qrferry-workspace");
    return () => document.documentElement.classList.remove("qrferry-workspace");
  }, []);
  return (
    <header className="workspace-header">
      <Link className="workspace-brand" href="/" aria-label="QRFerry">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>
          <strong>QRFerry</strong>
          <small dir="ltr">{WORKSPACE_VERSION}</small>
        </span>
      </Link>
      <nav
        className="workspace-nav"
        aria-label={lang === "ar" ? "طريقة النقل" : "Transfer mode"}
      >
        <Link href="/" aria-current={active === "send" ? "page" : undefined}>
          <ArrowUpRight size={18} />
          {t("nav.send")}
        </Link>
        <Link
          href="/scan"
          aria-current={active === "scan" ? "page" : undefined}
        >
          <ScanLine size={18} />
          {t("nav.scan")}
        </Link>
        <Link href="/tv">
          <Tv size={18} />
          {lang === "ar" ? "التلفزيون" : "TV"}
        </Link>
      </nav>
      <button
        type="button"
        className="workspace-language"
        onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        aria-label="Switch language / تبديل اللغة"
      >
        {lang === "ar" ? "EN" : "ع"}
      </button>
    </header>
  );
}

/** Children stay mounted: expanding a panel must not recreate canvases or reset inputs. */
export function WorkspaceDisclosure({
  title,
  children,
  className = "",
  badge,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <section className={`workspace-disclosure ${className}`}>
      <button
        ref={toggle}
        type="button"
        className="workspace-disclosure-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        {badge ? <small>{badge}</small> : null}
        <ChevronDown size={19} aria-hidden="true" />
      </button>
      <div
        id={id}
        className="workspace-disclosure-content"
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
            toggle.current?.focus();
          }
        }}
      >
        {children}
      </div>
    </section>
  );
}

/** Keyboard-safe modal with focus restoration and scroll containment. */
export function WorkspaceDialog({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const { lang } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? [],
      ).filter(
        (el) => el.getClientRects().length > 0 && !el.closest("[hidden]"),
      );
      const first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="modal-backdrop workspace-modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal-card workspace-modal ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="dialog-dismiss"
          aria-label={lang === "ar" ? "إغلاق النافذة" : "Close dialog"}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}
