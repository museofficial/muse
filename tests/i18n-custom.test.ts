import {promises as fs} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {BASE_LOCALE, getLocales, LocalizedError, setLocaleOverride, t, type LocaleDefinition} from '../src/i18n/index.js';
import {findMissingKeys, loadBundledLocales, loadCustomLocales, validateLocale, writeLocaleTemplate} from '../src/i18n/custom.js';

await loadBundledLocales();

const locales = getLocales() as Map<string, LocaleDefinition>;
const originalLocales = new Map(locales);
let directory: string;

const writePack = async (fileName: string, pack: unknown) =>
  fs.writeFile(path.join(directory, fileName), typeof pack === 'string' ? pack : JSON.stringify(pack));

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'muse-locales-'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  setLocaleOverride('');
  locales.clear();
  for (const [code, definition] of originalLocales) {
    locales.set(code, definition);
  }

  vi.restoreAllMocks();
  await fs.rm(directory, {force: true, recursive: true});
});

describe('validateLocale', () => {
  it('accepts a partial pack with extra plural forms', () => {
    const pack = {name: 'Polski', messages: {'stop.done': 'zatrzymano', 'embed.songCount.few': '{count} utwory'}};

    expect(validateLocale('pl', pack)).toEqual({code: 'pl', definition: pack, problems: []});
  });

  it('keeps the good lines and reports every bad one', () => {
    const pack = {
      name: '',
      messages: {
        'pause.done': 'paused, friend',
        'not.a.key': 'x',
        'stop.done': 3,
        'volume.done': 'volume {lvl}',
        'clear.done': '   ',
        'command.clear': 'x'.repeat(101),
      },
    };

    const {code, definition, problems} = validateLocale('es-es', pack);

    expect(code).toBe('es-ES');
    expect(definition).toEqual({name: 'es-es', messages: {'pause.done': 'paused, friend'}});
    expect(problems).toEqual([
      'loaded as "es-ES". Rename the file to match.',
      '"name" must be non-empty text, using "es-es" instead',
      'unknown key "not.a.key"',
      '"stop.done" must be non-empty text',
      '"volume.done" must use exactly these placeholders: {level}',
      '"clear.done" must be non-empty text',
      '"command.clear" is 101 characters, Discord allows 100',
    ]);
  });

  it.each(['not a code', 'en_US'])('cannot use the file name %j', code => {
    const {code: registeredCode, definition, problems} = validateLocale(code, {name: 'x', messages: {}});

    expect(registeredCode).toBeUndefined();
    expect(definition).toBeUndefined();
    expect(problems[0]).toContain('is not a locale code');
  });

  it('cannot use a pack without a messages object', () => {
    expect(validateLocale('fr', {name: 'Français', messages: ['arrêté']})).toEqual({
      problems: ['"messages" must be an object of keys and text'],
    });
  });

  it('drops a __proto__ key instead of copying it', () => {
    const pack: unknown = JSON.parse('{"name": "x", "messages": {"__proto__": {"polluted": true}}}');

    expect(validateLocale('fr', pack).problems).toEqual(['unknown key "__proto__"']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops command names Discord would reject', () => {
    const pack = {
      name: 'Français',
      messages: {
        'commandName.stop': 'arrêter',
        'commandName.pause': 'Pause',
        'commandName.play': 'jouer musique',
        'commandName.queue': 'f'.repeat(33),
      },
    };

    const {definition, problems} = validateLocale('fr', pack);

    expect(definition?.messages).toEqual({'commandName.stop': 'arrêter'});
    expect(problems).toEqual(['commandName.pause', 'commandName.play', 'commandName.queue']
      .map(key => `"${key}" must be 1 to 32 lowercase letters, numbers, - or _, with no spaces`));
  });

  it('drops command names that clash with a sibling in the same language', () => {
    locales.set('fr', {name: 'Français', messages: {'commandName.skip': 'passer'}});
    const pack = {
      name: 'Français',
      messages: {
        'commandName.next': 'passer',
        'commandName.pause': 'stop',
        'commandName.play.query': 'recherche',
        'commandName.queue.page': 'recherche',
      },
    };

    const {definition, problems} = validateLocale('fr', pack);

    expect(definition?.messages).toEqual({'commandName.play.query': 'recherche', 'commandName.queue.page': 'recherche'});
    expect(problems).toEqual([
      '"commandName.next" is also the name of "commandName.skip"',
      '"commandName.pause" is also the name of "commandName.stop"',
    ]);
  });

  it('counts missing lines without requiring every plural form', () => {
    const missing = findMissingKeys({'embed.songCount.other': '{count} canciones'});

    expect(missing).not.toContain('embed.songCount.other');
    expect(missing).not.toContain('embed.songCount.one');
    expect(missing).toContain('stop.done');
  });
});

describe('loadBundledLocales', () => {
  it('registers every pack file in src/i18n/locales without listing them in code', () => {
    expect([...locales.keys()]).toEqual([BASE_LOCALE, 'en-US-x-southern', 'es-ES']);
  });

  it('picks up a new JSON pack, ignores other files, and skips a broken one without a missing-lines warning', async () => {
    await writePack('fr.json', {name: 'Fran\u00e7ais', messages: {'stop.done': 'arr\u00eat\u00e9'}});
    await writePack('de.json', '{\"name\": ');
    await writePack('it.ts', 'export default {};');
    await writePack('notes.txt', 'not a pack');

    await expect(loadBundledLocales(directory)).resolves.toEqual(['fr']);

    expect(t('fr', 'stop.done')).toBe('arr\u00eat\u00e9');
    expect(locales.has('de')).toBe(false);
    expect(locales.has('it')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`Skipping bundled locale ${path.join(directory, 'de.json')}:`));
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('lines fall back'));
  });

  it('warns when the bundled folder is missing, since the build should always copy it', async () => {
    await expect(loadBundledLocales(path.join(directory, 'missing'))).resolves.toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read bundled locales'));
  });

  it('copies only the JSON packs into dist as part of the build', async () => {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8')) as {scripts: Record<string, string>};
    expect(packageJson.scripts.build).toMatch(/^tsc && node dist\/scripts\/copy-locales\.js( && |$)/);

    const originalCwd = process.cwd();
    await fs.mkdir(path.join(directory, 'src', 'i18n', 'locales'), {recursive: true});
    await writePack(path.join('src', 'i18n', 'locales', 'fr.json'), {name: 'Fran\u00e7ais', messages: {}});
    await writePack(path.join('src', 'i18n', 'locales', `${BASE_LOCALE}.ts`), 'export default {};');
    try {
      process.chdir(directory);
      vi.resetModules();
      await import('../src/scripts/copy-locales.js');
    } finally {
      process.chdir(originalCwd);
    }

    await expect(fs.readdir(path.join(directory, 'dist', 'i18n', 'locales'))).resolves.toEqual(['fr.json']);
  });
});

describe('loadCustomLocales', () => {
  it('ignores a missing directory and non-JSON files', async () => {
    await writePack('notes.txt', 'not a pack');

    await expect(loadCustomLocales(path.join(directory, 'missing'))).resolves.toEqual([]);
    await expect(loadCustomLocales(directory)).resolves.toEqual([]);
  });

  it('registers a personality pack that BOT_LOCALE can select, and warns about missing lines', async () => {
    await writePack('en-US-x-pirate.json', {name: 'English (Pirate)', messages: {'stop.done': 'aye, we be stopped'}});

    await expect(loadCustomLocales(directory)).resolves.toEqual(['en-US-x-pirate']);
    setLocaleOverride('en-US-x-pirate');

    expect(t('de', 'stop.done')).toBe('aye, we be stopped');
    expect(t('de', 'shuffle.done')).toBe('shuffled');
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^Custom locale en-US-x-pirate\.json: \d+ lines fall back to en-US, such as /));
  });

  it('serves a real language to matching Discord users without BOT_LOCALE', async () => {
    await writePack('es-ES.json', {name: 'Español', messages: {'stop.done': 'detenido'}});

    await loadCustomLocales(directory);

    expect(t('es-ES', 'stop.done')).toBe('detenido');
    expect(t('de', 'stop.done')).toBe('u betcha, stopped');
  });

  it('changes only the listed lines of a bundled pack, and keeps English error text in logs', async () => {
    await writePack(`${BASE_LOCALE}.json`, {name: 'English (Custom)', messages: {'error.nothingPlaying': 'silence, friend'}});
    await writePack('en-US-x-southern.json', {name: 'English (Southern)', messages: {'stop.done': 'all done, y\'all'}});

    await loadCustomLocales(directory);

    expect(t(BASE_LOCALE, 'stop.done')).toBe('u betcha, stopped');
    const error = new LocalizedError('error.nothingPlaying');
    expect(error.message).toBe('nothing is playing');
    expect(error.localize(BASE_LOCALE)).toBe('silence, friend');

    setLocaleOverride('en-US-x-southern');
    expect(t(BASE_LOCALE, 'stop.done')).toBe('all done, y\'all');
    expect(t(BASE_LOCALE, 'pause.done')).toBe('hold your horses');
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining(`${BASE_LOCALE}.json`));
  });

  it('skips unreadable files with a warning and still loads the others', async () => {
    await writePack('fr.json', '{"name": ');
    await writePack('de.json', {name: 'Deutsch', messages: 'nope'});
    await writePack('es-ES.json', {name: 'Español', messages: {'stop.done': 'detenido'}});

    await expect(loadCustomLocales(directory)).resolves.toEqual(['es-ES']);

    expect(locales.has('fr')).toBe(false);
    expect(locales.has('de')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`Skipping custom locale ${path.join(directory, 'fr.json')}:`));
    expect(console.warn).toHaveBeenCalledWith('Skipping custom locale de.json:\n  - "messages" must be an object of keys and text');
  });

  it('loads the good lines of a partly broken pack and warns about the rest', async () => {
    await writePack('fr.json', {name: 'Français', messages: {'stop.done': 'arrêté {extra}', 'pause.done': 'en pause'}});

    await expect(loadCustomLocales(directory)).resolves.toEqual(['fr']);

    expect(t('fr', 'pause.done')).toBe('en pause');
    expect(t('fr', 'stop.done')).toBe('u betcha, stopped');
    expect(console.warn).toHaveBeenCalledWith('Custom locale fr.json loaded with problems. Skipped lines use the en-US text:\n  - "stop.done" must use exactly these placeholders: (none)');
  });

  it('warns and continues when the locales path is not a folder', async () => {
    await writePack('notes.txt', 'not a folder');

    await expect(loadCustomLocales(path.join(directory, 'notes.txt'))).resolves.toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('using bundled packs only'));
  });
});

describe('writeLocaleTemplate', () => {
  it('writes every base line under the canonical code, ready to load as a custom pack', async () => {
    const localesDirectory = path.join(directory, 'locales');

    await expect(writeLocaleTemplate('pt-br', localesDirectory)).resolves.toBe(path.join(localesDirectory, 'pt-BR.json'));

    const pack = JSON.parse(await fs.readFile(path.join(localesDirectory, 'pt-BR.json'), 'utf8')) as LocaleDefinition;
    expect(pack).toEqual({name: 'pt-BR', messages: locales.get(BASE_LOCALE)!.messages});
    expect(validateLocale('pt-BR', pack).problems).toEqual([]);

    await expect(loadCustomLocales(localesDirectory)).resolves.toEqual(['pt-BR']);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('never overwrites an existing pack', async () => {
    await writePack('fr.json', 'my translation');

    await expect(writeLocaleTemplate('fr', directory)).rejects.toThrow(`${path.join(directory, 'fr.json')} already exists`);
    await expect(fs.readFile(path.join(directory, 'fr.json'), 'utf8')).resolves.toBe('my translation');
  });

  it.each(['', 'not a code', '../fr'])('rejects the code %j without writing anything', async code => {
    await expect(writeLocaleTemplate(code, directory)).rejects.toThrow('is not a locale code');
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });

  it('is available as a package script', async () => {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8')) as {scripts: Record<string, string>};
    expect(packageJson.scripts['locale:template']).toBe('tsx src/scripts/locale-template.ts');
  });
});
