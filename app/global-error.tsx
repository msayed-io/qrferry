"use client";

import { LangProvider } from "./lang-provider";

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void _error;
  return (
    <html lang="ar" dir="rtl">
      <body>
        <LangProvider>
          <h2>حدث خطأ ما!</h2>
          <button onClick={() => reset()}>حاول مجدداً</button>
        </LangProvider>
      </body>
    </html>
  );
}
