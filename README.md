<p align="center">
  <img width="250" height="250" src="https://raw.githubusercontent.com/museofficial/muse/master/.github/logo.png">
</p>

> [!IMPORTANT]
> Muse is now community-maintained under the [`museofficial`](https://github.com/museofficial) organization. For Docker, use `ghcr.io/museofficial/muse` as the canonical image source. Docker Hub tags may be published as compatibility mirrors, but GHCR is the supported target for new deployments.

------

Muse is a **highly-opinionated midwestern self-hosted** Discord music bot **that doesn't suck**. It's made for small to medium-sized Discord servers/guilds (think about a group the size of you, your friends, and your friend's friends).

![Hero graphic](.github/hero.png)

## Features

- 🎥 Livestreams
- ☁️ SoundCloud tracks, share links, and playlists
- ⏩ Seeking within a song/video
- 💾 Local caching for better performance
- 📋 No vote-to-skip - this is anarchy, not a democracy
- ↔️ Autoconverts playlists / artists / albums / songs from Spotify
- ⭐ Users can save favorite queries for reuse
- 1️⃣ Muse instance supports multiple guilds
- 🔊 Configurable volume controls, including optional ducking when people speak
- ✍️ Written in TypeScript, easily extendable
- ❤️ Loyal Packers fan

## Running

Muse is written in TypeScript. You can either run Muse with Docker (recommended) or directly with Node.js. Both methods require the Discord and YouTube API keys below. Spotify keys are optional and enable Spotify URL conversion:

- `DISCORD_TOKEN` can be acquired [here](https://discordapp.com/developers/applications) by creating a 'New Application', then going to 'Bot'.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` can be acquired [here](https://developer.spotify.com/dashboard/applications) with 'Create a Client ID'.
- `YOUTUBE_API_KEY` can be acquired by [creating a new project](https://console.developers.google.com) in Google's Developer Console, enabling the YouTube API, and creating an API key under credentials.

Muse will log a URL when run. Open this URL in a browser to invite Muse to your server. Muse will DM the server owner after it's added with setup instructions.

The shared player card uses labeled buttons for previous track, rewind,
pause/resume, fast-forward, next track, queue, and shuffle. Use `/stop` to stop
playback and disconnect Muse. If Muse is already in your server, make sure its
role has **View Channel**, **Send Messages**,
**Embed Links**, and **Read Message History** permissions. Check the text
channel's permission overrides too. Button controls do not require **Add
Reactions** or **Manage Messages**.

A 64-bit OS is required to run Muse.

### Versioning

The `master` branch acts as the developing / bleeding edge branch and is not guaranteed to be stable.

When running a production instance, I recommend that you use the [latest release](https://github.com/museofficial/muse/releases/).


### 🐳 Docker

There are a variety of image tags available:
- `:2`: versions >= 2.0.0
- `:2.1`: versions >= 2.1.0 and < 2.2.0
- `:2.1.1`: an exact version specifier
- `:latest`: whatever the latest version is
- `:yt-dlp-latest`: the latest release rebuilt with the newest available `yt-dlp`

(Replace empty config strings with correct values.)

```bash
docker run -it -v "$(pwd)/data":/data -e DISCORD_TOKEN='' -e SPOTIFY_CLIENT_ID='' -e SPOTIFY_CLIENT_SECRET='' -e YOUTUBE_API_KEY='' ghcr.io/museofficial/muse:latest
```

This starts Muse and creates a data directory in your current directory.

You can also store your tokens in an environment file and make it available to your container. By default, the container will look for a `/config` environment file. You can customize this path with the `ENV_FILE` environment variable to use with, for example, [docker secrets](https://docs.docker.com/engine/swarm/secrets/). 

**Docker Compose**:

```yaml
services:
  muse:
    image: ghcr.io/museofficial/muse:latest
    restart: always
    volumes:
      - ./muse:/data
      # Optional: mount YouTube-only cookies for age-restricted videos.
      # - ./youtube-cookies.txt:/run/secrets/youtube-cookies.txt:ro
    environment:
      - DISCORD_TOKEN=
      - YOUTUBE_API_KEY=
      - SPOTIFY_CLIENT_ID=
      - SPOTIFY_CLIENT_SECRET=
      # - YT_DLP_COOKIES_PATH=/run/secrets/youtube-cookies.txt
```

If you keep the same `DISCORD_TOKEN`, reuse the same `/data` volume, and point your Compose service at a newer image tag, Muse will come back up with the same bot identity and persisted database/cache.

### Node.js

**Prerequisites**:
* Node.js 22.12.0 or newer
* ffmpeg (4.1 or later)
* `yt-dlp` on your `PATH` (or set `YT_DLP_PATH` to its full path)

1. `git clone https://github.com/museofficial/muse.git && cd muse`
2. Copy `.env.example` to `.env` and populate with values
3. I recommend checking out a tagged release with `git checkout v[latest release]`
4. `yarn install` (or `npm i`)
5. `yarn start` (or `npm run start`)

**Note**: if you're on Windows, you may need to manually set the ffmpeg path. See [#345](https://github.com/museofficial/muse/issues/345) for details.

### Local validation

Run the behavior suite locally with:

```bash
npm test
```

## ⚙️ Additional configuration (advanced)

### Playback display and controls

Muse keeps one shared player card for each listening session. While music plays,
it uses the classic display: album art, progress bar, requester, source, and
upcoming tracks. Queue count and duration appear only when songs are waiting;
page numbers appear only in the full queue view. Each `/play` or `/favorites use`
request gets a public "u betcha" receipt. Discord identifies the requester above
the command reply, so the receipt does not repeat their name or mention them.
Playlists get one receipt for the whole request. The newest receipt in the
session's text channel carries the player card and controls; older receipts keep
only their short confirmation. Requests in other channels leave the card in the
channel where the session started. Starting with v2.12.0, queue confirmations
are always public. The former `set-queue-add-response-hidden` setting has been
removed, and previously saved values no longer apply. Optional next-song
announcements remain separate and are off by default.

When the queue ends, the card becomes a listening history. It lists the songs
that actually started, in playback order, and marks skipped tracks. Repeat plays
appear separately. Songs removed before they played, and songs that could not
start, are not listed. The full history is visible in the channel without
clicking a button. Longer histories continue in additional messages only when
Discord's message limits require it.

Adding more music while Muse is still connected continues the same session and
returns the card to the classic player. The history stays saved for the next
recap. Stopping playback or disconnecting ends the session and leaves its recap
in the channel. History is saved in Muse's database and remains available after
a restart; music and the queue are not resumed automatically.

The timer updates every five seconds by default. Set
`PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS` in `.env` to a whole number of seconds
greater than zero, then restart Muse to change this. Volume and loop changes
update the card immediately, including while paused. Long titles, source labels,
and stream URLs are shortened for display when needed to fit Discord messages;
playback uses the full URL.

The card has labeled buttons. To control playback, you must be in the same voice
channel as Muse and be allowed to use the matching command in the card's text
channel. Being a listener does not grant extra permissions. You can change who
can use commands and where under **Server Settings > Integrations > Muse**.
Muse checks permissions each time you click a control. If it cannot check them,
it does not perform the action.

| Control | Command you need permission to use |
| --- | --- |
| Previous | `/unskip` |
| Next | `/next` |
| −10s | `/seek` |
| +10s | `/fseek` |
| Pause / Resume | `/pause` while playing; `/resume` while paused |
| Shuffle | `/shuffle` |

The −10s and +10s buttons move ten seconds within a song and do not work on
livestreams. Previous, seek, Pause / Resume, and Next form the first row; Queue
and Shuffle form the second. Use `/stop` to stop playback and disconnect Muse.
Recaps have no buttons, including while Muse stays connected with an empty queue.
The complete history remains visible.

Shuffling removes repeated songs from the upcoming queue, including songs
that are playing now or have already played. When you add a playlist with
shuffle enabled, Muse removes repeats within that playlist. Different chapters
of the same track stay separate.

YouTube playlist imports stop once they have enough playable tracks for
`/config set-playlist-limit`. Private and deleted entries do not count toward
that limit; each split chapter counts as one track. Video-detail requests are
limited to three at a time across imports and lookups. This reduces request
bursts, but your YouTube API project's daily quota still applies.

### Language and personality

Muse replies in each user's Discord language when a translation exists, and
falls back to English (Midwestern). To use one language or personality pack
for everyone, set `BOT_LOCALE` in your `.env` file to a registered pack such as
`en-US-x-southern` (English with a Southern accent), then restart Muse. To
change Muse's text without editing code, put JSON packs in `data/locales/`. See
[src/i18n/README.md](src/i18n/README.md) for adding languages and packs.

### Favorites

A favorite is a named search or track/playlist URL saved for this server. It
stores the input you would give `/play`, not audio or a copy of the current
queue. Anyone in the server who can use `/favorites use` can queue that saved
input again.

For example, create one with `/favorites create name:lofi query:lofi hip hop`,
then use `/favorites use name:lofi` to play it. Use `/favorites list` to see the
server's favorites and `/favorites remove name:lofi` to remove one you created.
The server owner can also remove other users' favorites.

Favorite names must contain 1–100 characters. `/favorites list` may shorten long
names and queries for display; the saved query is still used in full. Existing
names longer than 100 characters can still be entered manually with
`/favorites use` or `/favorites remove`.

### Leaving voice when the queue ends

`/config set-wait-after-queue-empties` takes a whole number of **seconds**.
For example, `delay:60` makes Muse wait 60 seconds after the queue ends before
leaving voice. Set `delay:0` to never leave because the queue is empty.
The separate `/config set-leave-if-no-listeners` setting can still make Muse
leave when everyone else leaves the channel.

Use `/help` in Discord for the command list and these usage examples. Its reply
is visible only to you.

### Intro and outro jingles

Muse can play a short jingle when `/play` makes it join voice and another before
it leaves voice via `/stop`, `/disconnect`, or the idle timeout. Both are off by
default. Set either one in your `.env` file to a bundled jingle name:

| Variable | Bundled options |
| --- | --- |
| `INTRO_SOUND` | `dark`, `bright`, `chime`, `packers` |
| `OUTRO_SOUND` | `dark`, `dark-tapestop`, `bright`, `chime`, `packers` |

```
INTRO_SOUND=dark
OUTRO_SOUND=dark
```

To use your own clip, set the variable to a file path instead, such as
`OUTRO_SOUND=./data/sounds/my-chant.mp3`. Any format ffmpeg can read works.
In Docker, put the file under the mounted `/data` volume and use
`/data/sounds/my-chant.mp3`. Clips are cut off after 15 seconds. If the name or
path doesn't match anything, Muse still starts but logs an error and leaves
that jingle off. Leave a variable unset, or set it to `none`, to turn that
jingle off.

To make a jingle quieter or louder than the music, set `INTRO_SOUND_VOLUME`
or `OUTRO_SOUND_VOLUME` to a percentage of the current playback volume, from
`0` to `200`. The default is `100`, so jingles follow `/volume` and the
server's default volume. For example, `INTRO_SOUND_VOLUME=50` plays the intro
at half the music's volume, and `OUTRO_SOUND_VOLUME=150` boosts a quiet outro.
An invalid value logs an error and uses `100`.

To also play the intro when `/play` restarts a finished queue while Muse is still
in voice, set `INTRO_SOUND_TRIGGER=queue-start`. The default, `join`, only plays
it when Muse joins voice. An invalid value logs an error and uses `join`.

### Cache

By default, Muse limits the total cache size to around 2 GB. If you want to change this, set the environment variable `CACHE_LIMIT`. For example, `CACHE_LIMIT=512MB` or `CACHE_LIMIT=10GB`.

### yt-dlp

Muse now uses `yt-dlp` to resolve playable YouTube media URLs. In Docker, the image already includes it. For direct Node.js installs, either put `yt-dlp` on your `PATH` or set `YT_DLP_PATH` in your environment file.

Muse logs `YT_DLP_VERSION` on startup. Set `YT_DLP_AUTO_UPDATE=true` to make Muse try to update the configured `yt-dlp` installation before connecting to Discord. This works best with the Docker image's bundled virtualenv, or when `YT_DLP_PATH` points at a virtualenv or standalone `yt-dlp` executable that Muse can update.

Age-restricted videos require cookies from an age-verified YouTube account. Export a YouTube-only Netscape cookie file using the [official yt-dlp guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies), mount it outside `/data`, and set `YT_DLP_COOKIES_PATH` to its container path. Treat this file like a password. Muse copies it to a private per-extraction temporary file because yt-dlp updates the cookie jar while it runs, so the mounted source may remain read-only and concurrent guilds do not share a writable cookie file.

Current YouTube extraction also requires a supported JavaScript runtime. The Docker image includes the matching `yt-dlp-ejs` package and uses its bundled Node.js runtime. Direct installs should install `yt-dlp[default]` and provide Node.js 22 or newer.

The `ghcr.io/museofficial/muse:yt-dlp-latest` image is rebuilt on a schedule from the latest Muse release with the newest `yt-dlp` published to PyPI. Versioned refresh tags are also published as `:<muse-version>-yt-dlp-<yt-dlp-version>`.

### SponsorBlock

Muse can skip non-music segments at the beginning or end of a Youtube music video (Using [SponsorBlock](https://sponsor.ajay.app/)). It is disabled by default. If you want to enable it, set the environment variable `ENABLE_SPONSORBLOCK=true` or uncomment it in your .env.
Being a community project, the server may be down or overloaded. When it happen, Muse will skip requests to SponsorBlock for a few minutes. You can change the skip duration by setting the value of `SPONSORBLOCK_TIMEOUT`.

### Custom Bot Status

In the default state, Muse has the status "Online" and the text "Listening to Music".
The configured status and activity are restored when Discord reconnects.

You can change them with these environment variables:

- `BOT_STATUS`:
  - `online` (Online)
  - `idle` (Away)
  - `dnd` (Do not Disturb)

- `BOT_ACTIVITY_TYPE`:
  - `PLAYING` (Playing XYZ)
  - `LISTENING` (Listening to XYZ)
  - `WATCHING` (Watching XYZ)
  - `STREAMING` (Streaming XYZ)

- `BOT_ACTIVITY`: the text that follows the activity type

- `BOT_ACTIVITY_URL` If you use `STREAMING` you MUST set this variable, otherwise it will not work! Here you write a regular YouTube or Twitch Stream URL.

#### Examples

**Muse is watching a movie and is DND**:
- `BOT_STATUS=dnd`
- `BOT_ACTIVITY_TYPE=WATCHING`
- `BOT_ACTIVITY=a movie`

**Muse is streaming Monstercat**:
- `BOT_STATUS=online`
- `BOT_ACTIVITY_TYPE=STREAMING`
- `BOT_ACTIVITY_URL=https://www.twitch.tv/monstercat`
- `BOT_ACTIVITY=Monstercat`

### Bot-wide commands

If you have Muse running in a lot of guilds (10+) you may want to switch to registering commands bot-wide rather than for each guild. (The downside to this is that command updates can take up to an hour to propagate.) To do this, set the environment variable `REGISTER_COMMANDS_ON_BOT` to `true`.

### Automatically turn down volume when people speak

You can configure the bot to automatically turn down the volume when people are speaking in the channel using the following commands:

- `/config set-reduce-vol-when-voice true` - Enable automatic volume reduction
- `/config set-reduce-vol-when-voice false` - Disable automatic volume reduction
- `/config set-reduce-vol-when-voice-target <volume>` - Set the target volume percentage when people speak (0-100, default is 20)

### Troubleshooting voice connection timeouts

Muse retries a stalled initial voice handshake up to three times, waiting up to 20 seconds per attempt. Requests are added to the queue only after the connection is ready; a failed join leaves the existing queue intact. A later successful request can still resume songs that were already queued intentionally.

The failure message includes the last voice and network states. `OpeningWs` means the secure connection to the voice server did not open; check outbound TCP access to the **port supplied by Discord**, which is not necessarily 443. `UdpHandshaking` means the voice server was reached but UDP discovery did not finish; check outbound UDP and return traffic through the firewall/NAT. Discord describes both steps in its [voice connection documentation](https://docs.discord.com/developers/topics/voice-connections).

Keep voice tokens, session IDs, encryption keys, and full protocol/debug payloads out of logs and bug reports. The network-state diagnostic reports only a state name.
