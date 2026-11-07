"use client";

import { useEffect } from "react";
import { observeRims } from "./rim";
import "./globals.css";
import "./workspace.css";
import { LangProvider, useI18n } from "./lang-provider";

function ErrorContent({ reset }: { reset: () => void }) {
  const { lang } = useI18n();
  return <main className="wrap card">
    <h2>{lang === "ar" ? "حدث خطأ ما!" : "Something went wrong."}</h2>
    <button className="glass tinted cap" onClick={reset}>
      {lang === "ar" ? "حاول مجدداً" : "Try again"}
    </button>
  </main>;
}

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void _error;
  useEffect(observeRims, []);
  return <html lang="en" dir="ltr"><body>
    <LangProvider><ErrorContent reset={reset} /></LangProvider>
  </body></html>;
}
