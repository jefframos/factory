/**
 * Every locale the game ships UI text for. 'en' is the source of truth
 * (games/dig/game/i18n/locales/en.json) — the rest are machine-translated
 * from it by tools/i18n/translate-i18n.mjs and checked in as plain JSON.
 */
export const SUPPORTED_LOCALES = [
    'en',
    'es',
    'it',
    'pt-br',
    'fr',
    'de',
    'ja',
    'ko',
    'zh-cn',
    'ru',
    'hi',
    'tr',
    'pl',
    'th',
    'uk',
    'id',
    'vi',
    'ar',
    'nl',
    'sv',
    'da',
    'no',
    'ro',
    'cs',
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
    hi: 'हिन्दी',
    tr: 'Türkçe',
    pl: 'Polski',
    th: 'ไทย',
    uk: 'Українська',
    id: 'Bahasa Indonesia',
    vi: 'Tiếng Việt',
    ar: 'العربية',
    nl: 'Nederlands',
    sv: 'Svenska',
    da: 'Dansk',
    no: 'Norsk',
    ro: 'Română',
    cs: 'Čeština',
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
    hi: 'ind',
    tr: 'tur',
    pl: 'pol',
    th: 'tha',
    uk: 'ukr',
    id: 'idn',
    vi: 'vnm',
    ar: 'ara',
    nl: 'nld',
    sv: 'swe',
    da: 'dnk',
    no: 'nor',
    ro: 'rou',
    cs: 'cze',
};