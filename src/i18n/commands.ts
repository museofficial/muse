import {Locale} from 'discord.js';
import baseMessages from './locales/en-US.js';
import {BASE_LOCALE, fallbackLocales, findMessage, isLocaleOverridden, matchLocale, resolveLocale, type MessageKey} from './index.js';

type KeyOverrides = Readonly<Partial<Record<string, MessageKey>>>;

interface DescribableNode {
  readonly name: string;
  readonly options?: readonly unknown[];
  setDescription(description: string): unknown;
}

interface CommandJSON {
  name: string;
  name_localizations?: Record<string, string> | null;
  description_localizations?: Record<string, string> | null;
  options?: CommandJSON[];
}

// From discord.js, whose discord-api-types knows newer Discord languages such as es-419 and id.
const discordLocales: readonly string[] = Object.values(Locale);

const keyFor = (path: string[], keys: KeyOverrides) => {
  const pathName = path.join('.');
  return keys[pathName] ?? `command.${pathName}`;
};

const nameKeyFor = (path: string[]) => `commandName.${path.join('.')}`;

const localizationsFor = (key: string): Record<string, string> => {
  const localizations: Record<string, string> = {};
  if (isLocaleOverridden()) {
    return localizations;
  }

  for (const discordLocale of discordLocales) {
    const match = matchLocale(discordLocale);
    const text = match === BASE_LOCALE ? undefined : findMessage(match, key);
    if (text !== undefined) {
      localizations[discordLocale] = text;
    }
  }

  return localizations;
};

const describeNode = (node: DescribableNode, path: string[], keys: KeyOverrides) => {
  const key = keyFor(path, keys);
  const description = fallbackLocales(resolveLocale(null))
    .map(code => findMessage(code, key))
    .find(text => text !== undefined) ?? findMessage(BASE_LOCALE, key);
  if (description === undefined) {
    throw new Error(`Missing slash command description "${key}" in the ${BASE_LOCALE} catalog`);
  }

  // The bundled text, since a custom en-US pack can't rename commands.
  const nameKey = nameKeyFor(path);
  const baseName = (baseMessages as Readonly<Record<string, string | undefined>>)[nameKey];
  if (baseName !== node.name) {
    throw new Error(`Slash command name "${nameKey}" in the ${BASE_LOCALE} catalog must be "${node.name}"`);
  }

  node.setDescription(description);
  for (const option of (node.options ?? []) as DescribableNode[]) {
    describeNode(option, [...path, option.name], keys);
  }
};

const addLocalizations = (json: CommandJSON, path: string[], keys: KeyOverrides): CommandJSON => {
  const names = localizationsFor(nameKeyFor(path));
  if (Object.keys(names).length > 0) {
    json.name_localizations = names;
  }

  const localizations = localizationsFor(keyFor(path, keys));
  if (Object.keys(localizations).length > 0) {
    json.description_localizations = localizations;
  }

  for (const option of json.options ?? []) {
    addLocalizations(option, [...path, option.name], keys);
  }

  return json;
};

/**
 * Fill in every description from `command.<command>.<subcommand>.<option>` keys, and translated names from the matching `commandName.` keys.
 * `keys` remaps a description path such as `play.query`. Interactions still use the English names, so handlers don't change.
 */
export const localizeCommand = <T extends DescribableNode & {toJSON(): unknown}>(builder: T, keys: KeyOverrides = {}): T => {
  describeNode(builder, [builder.name], keys);

  // @discordjs/builders 1.1.0 rejects languages newer than its own list (es-419, id), so translations go in after its checks.
  const toJSON = builder.toJSON.bind(builder);
  Object.assign(builder, {toJSON: () => addLocalizations(toJSON() as CommandJSON, [builder.name], keys)});
  return builder;
};
