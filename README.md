<p align="center">
  <img width="250" height="250" src="https://raw.githubusercontent.com/codetheweb/muse/master/.github/logo.png">
</p>

Muse is a **highly-opinionated midwestern self-hosted** Discord music bot **that doesn't suck**. It's made for small to medium-sized Discord servers/guilds (think about a group the size of you, your friends, and your friend's friends).

### Features

- 🎥 Livestreams
- ⏩ Seeking within a song/video
- 💾 Local caching for better performance
- 📋 No vote-to-skip - this is anarchy, not a democracy
- ↔️ Autoconverts playlists / artists / albums / songs from Spotify
- ↗️ Users can add custom shortcuts (aliases)
- 1️⃣ Muse instance supports multiple guilds
- ✍️ Written in TypeScript, easily extendable
- ❤️ Loyal Packers fan

### Design Philosophy

I believe it makes much more sense to let Discord handle user permissions (whenever possible) rather than building them into a bot and adding additional complexity. Instead of only allowing users with a certain role to control Muse, Muse allows anyone who has access to its bound channel to control it. Instead of specifying the owner as a user ID in the config, Muse simply looks at the guild owner.

### Running

Muse is written in TypeScript. You can either run Muse with Docker (recommended) or directly with Node.js. Both methods require API keys passed in as environment variables:

- `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` can be acquired [here](https://discordapp.com/developers/applications) by creating a 'New Application', then going to 'Bot'.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` can be acquired [here](https://developer.spotify.com/dashboard/applications) with 'Create a Client ID'.
- `YOUTUBE_API_KEY` can be acquired by [creating a new project](https://console.developers.google.com) in Google's Developer Console, enabling the YouTube API, and creating an API key under credentials.

Muse will log a URL when run. Open this URL in a browser to invite Muse to your server.

#### Docker

(Replace empty config strings with correct values.)

```bash
docker run -it -v "$(pwd)/data":/data -e DISCORD_TOKEN='' -e DISCORD_CLIENT_ID='' -e SPOTIFY_CLIENT_ID='' -e SPOTIFY_CLIENT_SECRET='' -e YOUTUBE_API_KEY='' codetheweb/muse
```

This starts Muse and creates a data directory in your current directory.

**Docker Compose**:

```yaml
version: '3.4'

services:
  muse:
    image: codetheweb/muse
    restart: always
    volumes:
      - ./muse:/data
    environment:
      - DISCORD_TOKEN=
      - DISCORD_CLIENT_ID=
      - YOUTUBE_API_KEY=
      - SPOTIFY_CLIENT_ID=
      - SPOTIFY_CLIENT_SECRET=
```

#### Node.js

**Prerequisites**: Node.js, ffmpeg

1. `git clone https://github.com/codetheweb/muse.git && cd muse`
2. Copy `.env.example` to `.env` and populate with values
3. `yarn install` (or `npm i`)
4. `yarn build` (or `npm run build`)
5. `yarn start` (or `npm run start`)
