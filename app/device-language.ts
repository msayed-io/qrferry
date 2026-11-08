import type { Lang } from '@/lib/i18n';

export function deviceLanguage(languages: readonly string[]): Lang {
  for (const value of languages) {
    const base = value.trim().toLowerCase().split(/[-_]/)[0];
    if (base === 'ar' || base === 'en') return base;
  }
  return 'en';
}

export function requestLanguage(value: string | null | undefined): Lang {
  const preferences = (value ?? '').split(',').map((part, index) => {
    const [tag, ...params] = part.trim().split(';');
    const quality = params.find(p => p.trim().startsWith('q='));
    return { tag, index, q: quality ? Number(quality.trim().slice(2)) : 1 };
  }).filter(p => Number.isFinite(p.q) && p.q > 0 && p.q <= 1)
    .sort((a,b) => b.q - a.q || a.index - b.index);
  return deviceLanguage(preferences.map(p => p.tag));
}
