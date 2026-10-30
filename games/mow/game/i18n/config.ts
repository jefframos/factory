/**
 * Every locale the game ships UI text for: Poki's recommended set, in its order (developers.poki.com/guide/localization
 * — EFIGS + Turkish, then Chinese / Japanese / Korean, then Brazilian Portuguese and Russian), plus Dutch, Polish,
 * Indonesian and Vietnamese (big Poki markets with their own localized sites). 'en' is the source of truth
 * (games/mow/game/i18n/locales/en.json); the rest are translated from it by `npm run i18n:update` (tools/i18n) and
 * checked in as plain JSON.
 */
export const SUPPORTED_LOCALES = [
    'en',
    'fr',
    'it',
    'de',
    'es',
    'tr',
    'zh-cn',
    'ja',
    'ko',
    'pt-br',
    'ru',
    'nl',
    'pl',
    'id',
    'vi',
] as const;

export type Locale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: string): value is Locale {
    return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Each language's own name for itself — shown in the language picker so a player can recognize their language regardless of the UI's current locale. */
export const LOCALE_LABELS: Record<Locale, string> = {
    en: 'English',
    es: 'Español',
    it: 'Italiano',
    'pt-br': 'Português (BR)',
    fr: 'Français',
    de: 'Deutsch',
    ja: '日本語',
    ko: '한국어',
    'zh-cn': '中文',
    ru: 'Русский',
    tr: 'Türkçe',
    pl: 'Polski',
    id: 'Bahasa Indonesia',
    vi: 'Tiếng Việt',
    nl: 'Nederlands',
};

/** UI atlas frame Icon_Flag_<code> for each locale (LanguagePanel.ts). */
export const LOCALE_FLAG_CODE: Record<Locale, string> = {
    en: 'eng',
    es: 'esp',
    it: 'ita',
    'pt-br': 'brz',
    fr: 'fra',
    de: 'deu',
    ja: 'jpn',
    ko: 'kor',
    'zh-cn': 'chn',
    ru: 'rus',
    tr: 'tur',
    pl: 'pol',
    id: 'idn',
    vi: 'vnm',
    nl: 'nld',
};