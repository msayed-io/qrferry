import type { Lang } from "@/lib/i18n";

/** First supported browser preference. Unsupported languages fall back to English. */
export function deviceLanguage(preferences: readonly string[]): Lang {
  for (const preference of preferences) {
    const base = preference.trim().toLowerCase().split(/[-_]/)[0];
    if (base === "ar" || base === "en") return base;
  }
  return "en";
}

/** Match the browser on the first server render, respecting Accept-Language weights. */
export function requestLanguage(header: string | null): Lang {
  const preferences = (header ?? "").split(",").map((part, index) => {
    const [tag, ...parameters] = part.trim().split(";");
    const quality = parameters.find(parameter => parameter.trim().startsWith("q="));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return { tag, q, index };
  }).filter(item => Number.isFinite(item.q) && item.q > 0 && item.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return deviceLanguage(preferences.map(item => item.tag));
}
