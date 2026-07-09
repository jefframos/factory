import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale, type Locale } from './config';
import en from './locales/en.json';
import es from './locales/es.json';
import it from './locales/it.json';
import ptBr from './locales/pt-br.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhCn from './locales/zh-cn.json';
import ru from './locales/ru.json';

type StringTable = typeof en;
export type StringId = keyof StringTable;
type StringVars = Record<string, string | number>;

const TABLES: Record<Locale, StringTable> = {
    en, es, it, 'pt-br': ptBr, fr, de, ja, ko, 'zh-cn': zhCn, ru,
};

/** DOM attribute a bound label writes its resolved string into — see bindLabel. */
type LabelAttr = 'textContent' | 'title';

function interpolate(template: string, vars: StringVars): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

/**
 * Single source of truth for every player-facing string, backed by the JSON
 * tables in ./locales/ (en.json is authored by hand; the rest are generated
 * from it by scripts/translate-i18n.ts). Two ways to consume a string:
 *
 * - One-shot: `Localization.getString('shop')` — for anything rebuilt from
 *   scratch on every render (this game's screens mostly work this way; see
 *   PlayerFlowController/ShopScreen), a locale change just means the next
 *   render already picks up the new text with no extra wiring needed.
 * - Live-bound: `Localization.bindLabel(el, 'settings')` — for a persistent
 *   element created once and kept around (e.g. SettingsButton's tooltip),
 *   so its text updates in place when the locale changes without the owner
 *   having to subscribe to onLocaleChange itself. Call unbindLabel(el) when
 *   the element is discarded, or the registry keeps it alive.
 */
class LocalizationService {
    private static readonly STORAGE_KEY = 'CLOG_LOCALE';

    static readonly instance = new LocalizationService();

    readonly onLocaleChange: Signal = new Signal();

    private locale: Locale = DEFAULT_LOCALE;
    private readonly labels = new Map<HTMLElement, { id: StringId; vars?: StringVars; attr: LabelAttr }>();

    get currentLocale(): Locale {
        return this.locale;
    }

    /**
     * Call once at boot, before any locale-dependent UI renders (see
     * index.ts's initialize(), alongside ShopStorage.load()/HighScoreStorage.load())
     * — restores whatever locale setLocale() last persisted via the current
     * platform's storage backend (see IPlatformConnection.getItem), falling
     * back to DEFAULT_LOCALE if nothing was saved yet or the saved value is
     * no longer a supported locale.
     */
    async load(): Promise<void> {
        try {
            const saved = await PlatformHandler.instance.platform.getItem(LocalizationService.STORAGE_KEY);
            if (saved && isSupportedLocale(saved)) this.locale = saved;
        } catch (e) {
            console.error('Localization: failed to load saved locale', e);
        }
    }

    /**
     * Updates the active locale and rebinds every live label immediately
     * (synchronous, so the UI never waits on storage to react), then
     * persists the choice via the current platform's storage backend —
     * awaited here so a caller that needs to know the save actually
     * completed (e.g. before navigating away) can await this call; fire-
     * and-forget callers (see LanguagePicker) are free to ignore the
     * returned promise.
     */
    async setLocale(locale: Locale): Promise<void> {
        if (!SUPPORTED_LOCALES.includes(locale) || locale === this.locale) return;
        this.locale = locale;
        for (const [el, { id, vars, attr }] of this.labels) el[attr] = this.getString(id, vars);
        this.onLocaleChange.dispatch(locale);
        try {
            await PlatformHandler.instance.platform.setItem(LocalizationService.STORAGE_KEY, locale);
        } catch (e) {
            console.error('Localization: failed to save locale', e);
        }
    }

    getString(id: StringId, vars?: StringVars): string {
        const template = TABLES[this.locale]?.[id] ?? TABLES[DEFAULT_LOCALE][id] ?? id;
        return vars ? interpolate(template, vars) : template;
    }

    /** Binds `el`'s textContent (or `.title`, for tooltips) to `id`, setting it now and on every future setLocale(). */
    bindLabel(el: HTMLElement, id: StringId, opts: { vars?: StringVars; attr?: LabelAttr } = {}): void {
        const attr = opts.attr ?? 'textContent';
        this.labels.set(el, { id, vars: opts.vars, attr });
        el[attr] = this.getString(id, opts.vars);
    }

    unbindLabel(el: HTMLElement): void {
        this.labels.delete(el);
    }
}

export const Localization = LocalizationService.instance;
