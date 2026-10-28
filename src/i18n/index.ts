import baseMessages from './locales/en-US.js';

type BaseMessages = typeof baseMessages;
export type MessageKey = keyof BaseMessages;

type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;
type Vars = Record<string, string | number>;
export type MessageArgs<K extends MessageKey> = [Placeholders<BaseMessages[K]>] extends [never]
  ? [vars?: undefined]
  : [vars: Record<Placeholders<BaseMessages[K]>, string | number>];

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type PluralKey = {[K in MessageKey]: K extends `${infer Prefix}.other` ? Prefix : never}[MessageKey];

export type Messages = Partial<Record<MessageKey | `${PluralKey}.${PluralCategory}`, string>>;
export type LocaleDefinition = {name: string; messages: Messages};

export const BASE_LOCALE = 'en-US';

// The JSON packs in locales/ are registered at startup by loadBundledLocales(). See README.md in this folder.
const locales = new Map<string, LocaleDefinition>([
  [BASE_LOCALE, {name: 'English (Midwestern)', messages: baseMessages}],
]);

export const getLocales = (): ReadonlyMap<string, LocaleDefinition> => locales;

/** Add a locale. A pack with an existing code only replaces the lines it contains. */
export const registerLocale = (code: string, definition: LocaleDefinition): void => {
  const existing = locales.get(code);
  const messages = existing ? {...existing.messages, ...definition.messages} : definition.messages;
  locales.set(code, {name: definition.name, messages});
};

let localeOverride: string | undefined;

/** Use `locale` for every message instead of the Discord language. An empty value clears it. */
export const setLocaleOverride = (locale?: string): void => {
  if (locale && !locales.has(locale)) {
    throw new Error(`Unknown BOT_LOCALE "${locale}". Registered locales: ${[...locales.keys()].join(', ')}`);
  }

  localeOverride = locale === '' ? undefined : locale;
};

export const isLocaleOverridden = (): boolean => localeOverride !== undefined;

/** Map a Discord locale such as `es-419` to a registered locale, falling back by language, then to the base. Ignores BOT_LOCALE. */
export const matchLocale = (locale?: string | null): string => {
  if (!locale) {
    return BASE_LOCALE;
  }

  if (locales.has(locale)) {
    return locale;
  }

  const [language] = locale.split('-');
  for (const code of locales.keys()) {
    if (code.split('-')[0] === language && !code.includes('-x-')) {
      return code;
    }
  }

  return BASE_LOCALE;
};

export const resolveLocale = (locale?: string | null): string => localeOverride ?? matchLocale(locale);

/** The locale's own text for `key`, without falling back to the base catalog. */
export const findMessage = (locale: string, key: string): string | undefined =>
  (locales.get(locale)?.messages as Readonly<Record<string, string | undefined>> | undefined)?.[key];

/**
 * The locales to search for a message, before the base catalog. A personality pack such as `es-ES-x-pirata`
 * is followed by its own language, so its missing lines stay in Spanish. English packs go straight to the base.
 */
export const fallbackLocales = (locale: string): string[] => {
  const privateUse = locale.indexOf('-x-');
  const parent = privateUse === -1 ? BASE_LOCALE : matchLocale(locale.slice(0, privateUse));
  return parent === BASE_LOCALE ? [locale] : [locale, parent];
};

const lookup = (locale: string, keys: string[]): string => {
  const catalogs = [...fallbackLocales(locale).map(code => locales.get(code)?.messages), baseMessages];
  for (const messages of catalogs as Array<Readonly<Record<string, string | undefined>> | undefined>) {
    for (const key of keys) {
      const template = messages?.[key];
      if (template !== undefined) {
        return template;
      }
    }
  }

  return keys[0];
};

const interpolate = (template: string, vars: Vars = {}): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : placeholder);

const render = (resolved: string, key: string, vars?: Vars): string =>
  interpolate(lookup(resolved, [key]), vars);

const translate = (locale: string | null | undefined, key: string, vars?: Vars): string =>
  render(resolveLocale(locale), key, vars);

export const t = <K extends MessageKey>(locale: string | null | undefined, key: K, ...args: MessageArgs<K>): string =>
  translate(locale, key, (args as [Vars?])[0]);

/** Pick the plural form of `key` for `count` using the locale's CLDR plural rules. */
export const tCount = (locale: string | null | undefined, key: PluralKey, count: number): string => {
  const resolved = resolveLocale(locale);
  const category = new Intl.PluralRules(resolved).select(count);

  return interpolate(lookup(resolved, [`${key}.${category}`, `${key}.other`]), {count});
};

/** An error whose message is shown to Discord users in their own language. */
export class LocalizedError<K extends MessageKey = MessageKey> extends Error {
  public readonly key: K;
  private readonly vars?: Vars;

  constructor(key: K, ...args: MessageArgs<K>) {
    // Logs and code that checks error text rely on the bundled English, even when a custom pack rewords en-US.
    super(interpolate(baseMessages[key], (args as [Vars?])[0]));
    this.key = key;
    this.vars = (args as [Vars?])[0];
  }

  public localize(locale: string | null | undefined): string {
    return translate(locale, this.key, this.vars);
  }
}
