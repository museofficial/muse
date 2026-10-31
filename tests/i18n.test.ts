import {afterEach, describe, expect, it} from 'vitest';
import {SlashCommandBuilder} from '@discordjs/builders';
import {BASE_LOCALE, fallbackLocales, getLocales, LocalizedError, resolveLocale, setLocaleOverride, t, tCount, type LocaleDefinition, type Messages} from '../src/i18n/index.js';
import {localizeCommand} from '../src/i18n/commands.js';
import {loadBundledLocales, validateLocale} from '../src/i18n/custom.js';

await loadBundledLocales();

const temporaryLocales: string[] = [];
const registerTemporaryLocale = (code: string, messages: Messages) => {
  (getLocales() as Map<string, LocaleDefinition>).set(code, {name: code, messages});
  temporaryLocales.push(code);
};

afterEach(() => {
  setLocaleOverride('');
  for (const code of temporaryLocales.splice(0)) {
    (getLocales() as Map<string, LocaleDefinition>).delete(code);
  }
});

describe('i18n', () => {
  it('renders base messages with their placeholders filled', () => {
    expect(t(BASE_LOCALE, 'volume.done', {level: 40})).toBe('Set volume to 40%');
    expect(t(BASE_LOCALE, 'stop.done')).toBe('u betcha, stopped');
  });

  it('does not re-interpolate placeholder-like text inside values', () => {
    expect(t(BASE_LOCALE, 'move.done', {title: '{position}', position: 2})).toBe('moved **{position}** to position **2**');
  });

  it.each([undefined, null, '', 'de', 'en-GB', 'constructor'])('falls back to the base locale for %s', locale => {
    expect(resolveLocale(locale)).toBe(BASE_LOCALE);
    expect(t(locale, 'shuffle.done')).toBe('shuffled');
  });

  it('selects plural forms with the locale plural rules', () => {
    expect(tCount(BASE_LOCALE, 'embed.songCount', 1)).toBe('1 song');
    expect(tCount(BASE_LOCALE, 'embed.songCount', 3)).toBe('3 songs');
  });

  it('keeps the base text as the error message and localizes on demand', () => {
    const error = new LocalizedError('favorites.error.nameLength', {max: 100});

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('favorite name must be between 1 and 100 characters');
    expect(error.localize('fr')).toBe(error.message);
  });

  it('rejects a BOT_LOCALE that is not registered', () => {
    expect(() => setLocaleOverride('en-US-x-pirate')).toThrow('Unknown BOT_LOCALE "en-US-x-pirate". Registered locales: en-US, en-US-x-southern, es-ES');
    expect(resolveLocale('en-US')).toBe(BASE_LOCALE);
  });

  it('never picks a personality pack from the Discord locale', () => {
    expect(resolveLocale('en-US')).toBe(BASE_LOCALE);
    expect(resolveLocale('en-GB')).toBe(BASE_LOCALE);
  });

  it('uses a personality pack for every message under BOT_LOCALE and falls back for missing lines', () => {
    setLocaleOverride('en-US-x-southern');

    expect(t('de', 'stop.done')).toBe('you got it, stopped');
    expect(t(BASE_LOCALE, 'volume.done', {level: 40})).toBe('turned \'er to 40%');
    expect(t('fr', 'seek.error.invalidValue')).toBe('invalid seek value');
    expect(tCount('de', 'embed.songCount', 2)).toBe('2 songs');

    const error = new LocalizedError('error.nothingPlaying');
    expect(error.message).toBe('nothing is playing');
    expect(error.localize('de')).toBe('ain\'t nothin\' playin\'');
  });

  it('falls back to the language of a non-English personality pack before English', () => {
    registerTemporaryLocale('es-ES-x-pirata', {'stop.done': 'arrr, paramos'});
    registerTemporaryLocale('fr-x-pirate', {'stop.done': 'arrr, on arrête'});
    setLocaleOverride('es-ES-x-pirata');

    expect(t('de', 'stop.done')).toBe('arrr, paramos');
    expect(t('de', 'volume.done', {level: 40})).toBe('Volumen ajustado al 40 %');
    expect(tCount('de', 'embed.songCount', 1)).toBe('1 canción');
    expect(fallbackLocales('es-ES-x-pirata')).toEqual(['es-ES-x-pirata', 'es-ES']);
    expect(fallbackLocales('en-US-x-southern')).toEqual(['en-US-x-southern']);
    expect(fallbackLocales('fr-x-pirate')).toEqual(['fr-x-pirate']);
  });

  it.each([undefined, ''])('follows the Discord locale when BOT_LOCALE is %j', locale => {
    setLocaleOverride(BASE_LOCALE);
    setLocaleOverride(locale);

    expect(resolveLocale('de')).toBe(BASE_LOCALE);
    expect(t('de', 'shuffle.done')).toBe('shuffled');
  });

  it.each([...getLocales()])('bundles a valid %s pack', (code, definition) => {
    expect(validateLocale(code, definition)).toEqual({code, definition, problems: []});
  });

  it.each(['es-ES', 'es-419'])('answers %s users in Spanish with Spanish plural rules', locale => {
    expect(resolveLocale(locale)).toBe('es-ES');
    expect(t(locale, 'volume.done', {level: 40})).toBe('Volumen ajustado al 40 %');
    expect(tCount(locale, 'embed.songCount', 1)).toBe('1 canción');
    expect(tCount(locale, 'embed.songCount', 3)).toBe('3 canciones');
    expect(new LocalizedError('error.nothingPlaying').localize(locale)).toBe('no está sonando nada');
  });
});

describe('slash command descriptions', () => {
  const buildVolume = () => localizeCommand(new SlashCommandBuilder()
    .setName('volume')
    .addIntegerOption(option => option.setName('level').setRequired(true)));

  it('fills every description from the base catalog and publishes the bundled Spanish', () => {
    const json = buildVolume().toJSON();

    expect(json.description).toBe('set current player volume level');
    // es-419 is newer than the locale list in @discordjs/builders 1.1.0, so this also proves the builder checks pass.
    expect(json.description_localizations).toEqual({
      'es-ES': 'Ajusta el volumen actual del reproductor',
      'es-419': 'Ajusta el volumen actual del reproductor',
    });
    expect(json.options?.[0]).toMatchObject({
      description: 'volume percentage (0 is muted, 100 is max & default)',
      description_localizations: {'es-419': 'Porcentaje de volumen (0 es silencio, 100 es el máximo y el valor por defecto)'},
    });
  });

  it('publishes translations for exact and same-language Discord locales, skipping missing lines', () => {
    registerTemporaryLocale('fr', {'command.volume': 'régler le volume'});
    registerTemporaryLocale('sv', {'command.volume': 'ställ in volymen', 'command.volume.level': 'volym i procent'});
    registerTemporaryLocale('en-US-x-test', {'command.volume': 'personality text'});

    const json = buildVolume().toJSON();

    expect(json.description).toBe('set current player volume level');
    expect(json.description_localizations).toMatchObject({fr: 'régler le volume', 'sv-SE': 'ställ in volymen'});
    expect(Object.values(json.description_localizations ?? {})).not.toContain('personality text');
    expect(json.description_localizations).not.toHaveProperty(['en-GB']);
    expect(json.options?.[0]).toMatchObject({description_localizations: {'sv-SE': 'volym i procent'}});
  });

  it('publishes translated names while keeping the English names that interactions use', () => {
    const json = buildVolume().toJSON();

    expect(json.name).toBe('volume');
    expect(json.name_localizations).toEqual({'es-ES': 'volumen', 'es-419': 'volumen'});
    expect(json.options?.[0]).toMatchObject({name: 'level', name_localizations: {'es-ES': 'nivel', 'es-419': 'nivel'}});
  });

  it('uses the BOT_LOCALE pack as the only description', () => {
    registerTemporaryLocale('en-US-x-test', {'command.volume': 'personality text'});
    setLocaleOverride('en-US-x-test');

    const json = buildVolume().toJSON();

    expect(json.description).toBe('personality text');
    expect(json.description_localizations).toBeUndefined();
    expect(json.name_localizations).toBeUndefined();
    expect(json.options?.[0]).toMatchObject({description: 'volume percentage (0 is muted, 100 is max & default)'});
  });

  it('describes commands in the language of a non-English BOT_LOCALE pack where it has no text', () => {
    registerTemporaryLocale('es-ES-x-pirata', {'command.volume': 'sube el ruido, grumete'});
    setLocaleOverride('es-ES-x-pirata');

    const json = buildVolume().toJSON();

    expect(json.description).toBe('sube el ruido, grumete');
    expect(json.options?.[0]).toMatchObject({description: 'Porcentaje de volumen (0 es silencio, 100 es el máximo y el valor por defecto)'});
  });

  it('applies key overrides and reports a missing description', () => {
    const play = localizeCommand(new SlashCommandBuilder()
      .setName('play')
      .addStringOption(option => option.setName('query')), {'play.query': 'command.play.queryWithSpotify'});

    expect(play.toJSON().options?.[0]).toMatchObject({description: 'YouTube URL, Spotify URL, or search query'});
    expect(() => localizeCommand(new SlashCommandBuilder().setName('missing')))
      .toThrow('Missing slash command description "command.missing" in the en-US catalog');
    expect(() => localizeCommand(new SlashCommandBuilder()
      .setName('volume')
      .addIntegerOption(option => option.setName('percent')), {'volume.percent': 'command.volume.level'}))
      .toThrow('Slash command name "commandName.volume.percent" in the en-US catalog must be "percent"');
  });
});
