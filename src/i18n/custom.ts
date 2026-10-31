import {promises as fs} from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import baseMessages from './locales/en-US.js';
import {BASE_LOCALE, fallbackLocales, getLocales, registerLocale, type LocaleDefinition, type Messages} from './index.js';

const base: Readonly<Record<string, string>> = baseMessages;
const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/;
const MAX_DESCRIPTION_LENGTH = 100;
const MAX_NAME_LENGTH = 32;
// Muse's TypeScript 4.x lib doesn't declare this ES2020 method, though Node supports it.
const {getCanonicalLocales} = Intl as unknown as {getCanonicalLocales(locale: string): string[]};

const hasOwn = (object: Readonly<Record<string, unknown>>, key: string) => Object.prototype.hasOwnProperty.call(object, key);

const canonicalLocale = (code: string): string | undefined => {
  try {
    return getCanonicalLocales(code)[0];
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const placeholdersOf = (template: string) => [...template.matchAll(/\{(\w+)\}/g)].map(([, name]) => `{${name}}`).sort().join(' ');

const baseKeyFor = (key: string): string | undefined => {
  if (hasOwn(base, key)) {
    return key;
  }

  const pluralOther = key.replace(PLURAL_SUFFIX, '.other');
  return pluralOther !== key && hasOwn(base, pluralOther) ? pluralOther : undefined;
};

// Discord's rule for command and option names.
const isCommandName = (name: string) =>
  name.length <= MAX_NAME_LENGTH && /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]+$/u.test(name) && name === name.toLowerCase();

/**
 * Discord rejects every command if two commands, or two options of one command, share a name in a language.
 * Drop the pack's names that clash, comparing against what the language already has and then the English names.
 */
const dropClashingNames = (messages: Record<string, string>, existing: Messages): {messages: Record<string, string>; problems: string[]} => {
  const known: Readonly<Record<string, string | undefined>> = existing;
  const keysByName = new Map<string, string[]>();
  for (const key of Object.keys(base).filter(key => key.startsWith('commandName.'))) {
    const name = messages[key] ?? known[key] ?? base[key];
    const sibling = `${key.slice(0, key.lastIndexOf('.'))} ${name}`;
    keysByName.set(sibling, [...keysByName.get(sibling) ?? [], key]);
  }

  const problems: string[] = [];
  const clashing = new Set<string>();
  for (const keys of keysByName.values()) {
    for (const key of keys.filter(key => keys.length > 1 && hasOwn(messages, key))) {
      problems.push(`"${key}" is also the name of ${keys.filter(other => other !== key).map(other => `"${other}"`).join(', ')}`);
      clashing.add(key);
    }
  }

  return {messages: Object.fromEntries(Object.entries(messages).filter(([key]) => !clashing.has(key))), problems};
};

/** Why one line of a pack can't be used, or undefined when it can. */
const lineProblem = (key: string, value: unknown): string | undefined => {
  const baseKey = baseKeyFor(key);
  if (baseKey === undefined) {
    return `unknown key "${key}"`;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return `"${key}" must be non-empty text`;
  }

  if (placeholdersOf(value) !== placeholdersOf(base[baseKey])) {
    return `"${key}" must use exactly these placeholders: ${placeholdersOf(base[baseKey]) || '(none)'}`;
  }

  if (key.startsWith('command.') && value.length > MAX_DESCRIPTION_LENGTH) {
    return `"${key}" is ${value.length} characters, Discord allows ${MAX_DESCRIPTION_LENGTH}`;
  }

  if (key.startsWith('commandName.') && !isCommandName(value)) {
    return `"${key}" must be 1 to ${MAX_NAME_LENGTH} lowercase letters, numbers, - or _, with no spaces`;
  }

  return undefined;
};

export type LocaleCheck = {
  /** The canonical code to register under, missing when the pack can't be used at all. */
  code?: string;
  definition?: LocaleDefinition;
  problems: string[];
};

/** Check a pack against the base catalog. Bad lines are dropped and reported, the rest stay usable. */
export const validateLocale = (code: string, input: unknown): LocaleCheck => {
  const problems: string[] = [];

  const canonical = canonicalLocale(code);
  if (canonical === undefined) {
    problems.push(`"${code}" is not a locale code. Use one such as es-ES or en-US-x-pirate.`);
  } else if (canonical !== code) {
    problems.push(`loaded as "${canonical}". Rename the file to match.`);
  }

  const hasName = isRecord(input) && typeof input.name === 'string' && input.name.trim() !== '';
  if (!hasName) {
    problems.push(`"name" must be non-empty text, using "${code}" instead`);
  }

  const rawMessages = isRecord(input) ? input.messages : undefined;
  if (!isRecord(rawMessages)) {
    problems.push('"messages" must be an object of keys and text');
    return {problems};
  }

  const lines: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawMessages)) {
    const problem = lineProblem(key, value);
    if (problem === undefined) {
      lines[key] = value as string;
    } else {
      problems.push(problem);
    }
  }

  if (canonical === undefined) {
    return {problems};
  }

  const {messages, problems: nameProblems} = dropClashingNames(lines, getLocales().get(canonical)?.messages ?? {});
  problems.push(...nameProblems);

  const name = hasName ? (input as {name: string}).name : code;
  return {code: canonical, definition: {name, messages: messages as Messages}, problems};
};

/** Base keys a pack leaves to the base catalog. Extra plural forms are optional, so only `.other` counts. */
export const findMissingKeys = (messages: Messages): string[] => Object.keys(base)
  .filter(key => !hasOwn(messages, key) && (!PLURAL_SUFFIX.test(key) || key.endsWith('.other')));

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const warn = (message: string, problems: string[] = []) => {
  console.warn([message, ...problems.map(problem => `  - ${problem}`)].join('\n'));
};

type PackFile = {fileName: string; code: string; input: unknown};
type PackKind = 'bundled' | 'custom';

const registerPacks = (kind: PackKind, files: Array<PackFile | undefined>): string[] => {
  const label = kind === 'custom' ? 'Custom locale' : 'Bundled locale';
  const codes: string[] = [];
  for (const {fileName, code: fileCode, input} of files.filter((file): file is PackFile => file !== undefined)) {
    const {code, definition, problems} = validateLocale(fileCode, input);
    if (code === undefined || definition === undefined) {
      warn(`Skipping ${kind} locale ${fileName}:`, problems);
    } else {
      if (problems.length > 0) {
        warn(`${label} ${fileName} loaded with problems. Skipped lines use the ${BASE_LOCALE} text:`, problems);
      }

      registerLocale(code, definition);
      codes.push(code);

      // Bundled personality packs are partial on purpose, so only bot owners get this reminder.
      // Lines a personality pack leaves out but its own language has aren't English, so they don't count.
      const catalogs = fallbackLocales(code).map(fallback => getLocales().get(fallback)?.messages ?? {});
      const missing = kind === 'custom' ? findMissingKeys(Object.assign({}, ...catalogs.reverse()) as Messages) : [];
      if (missing.length > 0) {
        warn(`${label} ${fileName}: ${missing.length} lines fall back to ${BASE_LOCALE}, such as ${missing.slice(0, 3).join(', ')}`);
      }
    }
  }

  return codes;
};

const BUNDLED_DIRECTORY = fileURLToPath(new URL('locales', import.meta.url));

const loadLocaleFolder = async (kind: PackKind, directory: string): Promise<string[]> => {
  let fileNames: string[];
  try {
    fileNames = await fs.readdir(directory);
  } catch (error: unknown) {
    // A missing custom folder just means the bot owner hasn't added packs, but bundled packs should always exist.
    if (kind === 'bundled' || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const fallback = kind === 'custom' ? 'bundled packs only' : `${BASE_LOCALE} only`;
      warn(`Could not read ${kind} locales in ${directory}, using ${fallback}: ${describeError(error)}`);
    }

    return [];
  }

  const files = await Promise.all(fileNames
    .filter(fileName => fileName.endsWith('.json'))
    .sort()
    .map(async (fileName): Promise<PackFile | undefined> => {
      const filePath = path.join(directory, fileName);
      try {
        const input = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
        return {fileName, code: fileName.slice(0, -'.json'.length), input};
      } catch (error: unknown) {
        warn(`Skipping ${kind} locale ${filePath}: ${describeError(error)}`);
        return undefined;
      }
    }));

  return registerPacks(kind, files);
};

/** Register every `<locale>.json` shipped in `locales/`, so a new language only needs its own file. Never throws. */
export const loadBundledLocales = async (directory = BUNDLED_DIRECTORY): Promise<string[]> => loadLocaleFolder('bundled', directory);

/** Register every `<locale>.json` in the bot owner's `directory`. Never throws: unusable files and lines are skipped with a warning. */
export const loadCustomLocales = async (directory: string): Promise<string[]> => loadLocaleFolder('custom', directory);

/** Write `<code>.json` with every base line in `directory`, as a starting point for a translation. Returns the file path. */
export const writeLocaleTemplate = async (code: string, directory: string): Promise<string> => {
  const canonical = canonicalLocale(code);
  if (canonical === undefined) {
    throw new Error(`"${code}" is not a locale code. Use one such as fr, pt-BR or en-US-x-pirate.`);
  }

  const filePath = path.join(directory, `${canonical}.json`);
  await fs.mkdir(directory, {recursive: true});
  try {
    await fs.writeFile(filePath, `${JSON.stringify({name: canonical, messages: base}, null, 2)}\n`, {flag: 'wx'});
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`${filePath} already exists. Delete or rename it first.`);
    }

    throw error;
  }

  return filePath;
};
