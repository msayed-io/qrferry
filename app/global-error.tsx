"use client";

import { LangProvider } from "./lang-provider";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
