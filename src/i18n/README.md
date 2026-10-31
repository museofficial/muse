# Adding a language

Every language pack is a JSON file with the same keys as [`locales/en-US.ts`](locales/en-US.ts), the **English (Midwestern)** base text. That base file is the only TypeScript one, because the code's type checks are built from it. To start a new pack, [generate a template](#starting-from-a-template) instead of copying it by hand.

A pack can live in one of two places. The format is the same in both:

| Folder | Who uses it | What's needed |
| --- | --- | --- |
| `src/i18n/locales/` | Contributors, to ship a pack with Muse | Pull request, then a new build |
| `data/locales/` (`/data/locales/` in Docker) | Bot owners, to add or change text without touching the code | Restart Muse |

Bundled languages:

| Code | Language | Notes |
| --- | --- | --- |
| `en-US` | English (Midwestern) | Base language |
| `es-ES` | Español (España) | Complete, including command names. Also used for Latin American Spanish (`es-419`). |
| `en-US-x-southern` | English (Southern) | Personality pack, see [Personality packs](#personality-packs) |

Translations come from the community, so Muse only speaks the languages people have contributed. A pack in `data/locales/` only works on the bot that has it. To make a language available to everyone by default, [open a pull request](#adding-a-language-to-muse) that adds it to `src/i18n/locales/`.

## How Muse picks a language

- Replies to a slash command use the language set in the Discord client of the person who ran it.
- Messages Muse sends on its own (the "next song" announcement and the welcome DM to the server owner) use the server's language, set under **Server Settings > Community > Overview**.
- If there's no pack for that exact language, Muse looks for another version of the same language (for example `es-419` falls back to `es-ES`). If there's none, it uses English (Midwestern).
- If `BOT_LOCALE` is set, Muse uses that pack for everything and ignores the Discord language. See [Personality packs](#personality-packs).

## Pack format

Name the file after its [Discord locale code](https://discord.com/developers/docs/reference#locales), for example `fr.json`, `pt-BR.json` or `de.json`:

```json
{
  "name": "Français",
  "messages": {
    "shuffle.done": "File mélangée",
    "volume.done": "Volume réglé à {level} %",
    "embed.songCount.one": "{count} chanson",
    "embed.songCount.other": "{count} chansons"
  }
}
```

- **Include only the lines you want.** Any key you leave out shows the English text, so a partial translation is fine.
- **It must be valid JSON.** Wrap the whole file in `{ }`, use double quotes, leave no comma after the last line, and save it as UTF-8.
- **There's nothing to register.** Muse loads every `.json` file in both folders when it starts.

### Starting from a template

This command writes `data/locales/<code>.json` with every English (Midwestern) line in it, so you only have to translate. It never overwrites an existing file.

```sh
# From a source checkout
yarn locale:template fr

# With Docker, using the same data folder as the bot
docker run --rm -v "$(pwd)/data":/data ghcr.io/museofficial/muse:latest node dist/scripts/locale-template.js fr
```

Then set `name`, translate the lines you want and delete the rest. The template always matches the Muse version that wrote it, so run it again into a new file after an update to see any new lines.

## Adding a language to Muse

A pull request is the best way to ship a language with Muse by default. Native speakers are welcome to review or improve an existing pack the same way.

1. **Create `src/i18n/locales/<code>.json`.** Run `yarn locale:template <code>` and move the file from `data/locales/`, or see [`locales/es-ES.json`](locales/es-ES.json) for a complete example.
2. **Run the tests**, which check every bundled pack against the English text:

   ```sh
   yarn test tests/i18n.test.ts
   ```

3. **Open a pull request** with the new file, and add the language to the [bundled languages](#adding-a-language) table.

Once it's merged, the build copies the JSON packs next to the compiled code, so they ship in the Docker image too.

## Custom packs

Bot owners can add or change text without editing Muse's code:

1. **Put the file in the `locales` folder inside Muse's data folder** (`DATA_DIR`, `./data` by default, or `/data` in Docker), for example `data/locales/fr.json`. The [template command](#starting-from-a-template) creates it there.
2. **Restart Muse.** Language packs work for matching Discord users right away. Personality packs also need `BOT_LOCALE`.

A custom file named after a bundled pack is merged into it. `data/locales/en-US.json` rewords only the Midwestern lines it lists, and `data/locales/es-ES.json` does the same for Spanish.

## What Muse checks when it starts

Mistakes in a pack never stop Muse. It logs a warning and:

- skips a line with an unknown key, empty text, a changed `{placeholder}` or a description over 100 characters, so that line uses the English text
- skips a command name that breaks [Discord's rules](#command-names) or is already used by another command or option at the same level
- skips the whole file if it isn't valid JSON, has no `messages` object, or its name isn't a locale code
- loads a file with the wrong capitalization (such as `es-es.json`) under the right code, and asks you to rename it
- for custom packs, lists how many lines are missing and use the English (Midwestern) text

## Translation rules

- **Keep every `{placeholder}` exactly as written.** Muse fills in values such as `{title}` or `{count}` at runtime. You can move them anywhere in the sentence, but don't rename, translate or drop them.
- **Keep Discord formatting.** Leave `**bold**`, `` `code` ``, emoji and mentions like `<@{user}>` in place.
- **Write commands the way your users see them.** If your pack translates command names (see [Command names](#command-names)), use those names in text such as `/favorites create name:lofi` in `help.usage`. If it doesn't, keep the English names.
- **Write line breaks as `\n`.** `help.usage` spans several lines, and JSON text can't contain real line breaks.
- **Match the tone if you want to.** The English text is deliberately folksy ("u betcha", "ope"). Feel free to use a regional flavor of your own language, or keep it plain.

## Plural forms

Keys that end in `.one` and `.other` (like `embed.songCount` and `queueAdd.notFound`) are plurals. Muse uses your language's plural rules to pick a form. If your language has more forms, add them with the matching suffix: `.zero`, `.one`, `.two`, `.few`, `.many` or `.other`. Polish, for example:

```json
"embed.songCount.one": "{count} utwór",
"embed.songCount.few": "{count} utwory",
"embed.songCount.many": "{count} utworów",
"embed.songCount.other": "{count} utworu"
```

Always include `.other`, since it's the fallback when a form is missing.

## Slash command descriptions

The text Discord shows under each command and option in the `/` menu comes from the `command.*` keys. The key is the command name, then the subcommand and option names, joined with dots:

```json
"command.queue": "Muestra la cola actual",
"command.queue.page-size": "Cuántos elementos mostrar por página [por defecto: 10, máx.: 30]",
"command.config.set-default-volume.level": "Porcentaje de volumen (0 es silencio, 100 es el máximo)"
```

- **Keep each one between 1 and 100 characters.** That's Discord's limit.
- **Restart Muse after changing them.** Descriptions are sent to Discord when Muse starts, and each user sees the version for their Discord language. Discord may take a minute to refresh its menu.
- Users whose Discord language has no translation see the English (Midwestern) text.
- A personality pack only changes descriptions when it's turned on with `BOT_LOCALE`. It then replaces the default text for everyone.

## Command names

Commands, subcommands and options can have translated names in the `/` menu too. They use the `commandName.*` keys, with the same paths as the descriptions:

```json
"commandName.favorites": "favoritos",
"commandName.favorites.create": "crear",
"commandName.favorites.create.name": "nombre"
```

- **Use 1 to 32 lowercase letters, numbers, `-` or `_`.** No spaces. Accented letters and other alphabets are fine.
- **Give each command a different name, and each option of one command a different name.** Muse skips a name that's already taken at the same level, since Discord would refuse every command otherwise.
- **Restart Muse after changing them**, the same as descriptions. Users whose Discord language has no translation see the English name.
- Names in `en-US` and in personality packs are ignored. The English names are part of Muse's code, and Discord would show a personality pack's names to nobody.

## Personality packs

A personality pack changes Muse's tone instead of its language, such as a pirate version of English or Spanish. Discord never asks for one, so the bot owner turns it on for every server with `BOT_LOCALE`.

Muse ships with one: [`locales/en-US-x-southern.json`](locales/en-US-x-southern.json), **English (Southern)**. Turn it on with `BOT_LOCALE=en-US-x-southern`, or use it as a template for your own.

1. **Name it with a private-use tag** after the language it's written in, for example `en-US-x-pirate.json` or `es-ES-x-pirata.json`. The `-x-` part keeps it from clashing with a real Discord locale.

2. **Include only the lines you want to change.** Everything else uses the pack's own language when Muse has it: `es-ES-x-pirata` falls back to Español (España), then to English (Midwestern). English packs fall back to the Midwestern text.

   ```json
   {
     "name": "English (Pirate)",
     "messages": {
       "stop.done": "aye, we be stopped",
       "skip.done": "hoist the sails",
       "error.prefix": "🏴‍☠️ arr: {message}"
     }
   }
   ```

3. **Turn it on** by setting `BOT_LOCALE`, then restart Muse:

   ```sh
   BOT_LOCALE=en-US-x-pirate
   ```

`BOT_LOCALE` is optional. When it's unset or empty, Muse follows each user's Discord language. When it's set, everyone gets that pack. If no pack has that code (for example, a typo), Muse logs a warning and follows Discord instead.

## Kept in English on purpose

- Command and option names in personality packs and under `BOT_LOCALE`, since Discord only translates names by language
- Detailed playback errors from FFmpeg and yt-dlp, which are diagnostics rather than something a user can act on
- Console and log output, which stays in English so bug reports are easy to read and search
