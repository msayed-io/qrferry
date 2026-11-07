import type { Lang } from '@/lib/i18n';

export function deviceLanguage(languages: readonly string[]): Lang {
  return languages.some((value) => value.toLowerCase().startsWith('ar')) ? 'ar' : 'en';
}

export function requestLanguage(value: string | null | undefined): Lang {
  return deviceLanguage((value ?? '').split(',').map((part) => part.split(';')[0].trim()).filter(Boolean));
}
