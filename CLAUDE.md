# CLAUDE.md - Muse Discord Music Bot

## Project Overview
**Muse** is a self-hosted Discord music bot written in TypeScript that provides music streaming capabilities for Discord servers. It's designed for small to medium-sized Discord guilds and supports multiple music sources including YouTube and Spotify.

### Key Features
- 🎥 Livestream support
- ⏩ Seeking within songs/videos
- 💾 Local caching for performance
- 📋 No vote-to-skip (anarchy mode)
- ↔️ Autoconverts Spotify playlists/artists/albums/songs
- ↗️ Custom user shortcuts/aliases
- 1️⃣ Multi-guild support
- 🔊 Volume normalization
- ✍️ Full TypeScript implementation

## Technology Stack

### Core Technologies
- **Runtime**: Node.js 22+ (LTS)
- **Language**: TypeScript (ES2020 target)
- **Build System**: TypeScript Compiler (tsc)
- **Package Manager**: Yarn 1.22.22

### Major Dependencies
- **Discord.js**: 14.11.0 - Discord API wrapper
- **@discordjs/voice**: 0.18.0 - Voice channel handling
- **@discordjs/opus**: 0.10.0 - Audio encoding
- **@distube/ytdl-core**: 4.16.10 - YouTube download
- **@distube/ytsr**: 2.0.4 - YouTube search
- **Prisma**: 5.21.1 - Database ORM
- **Inversify**: 6.0.1 - Dependency injection
- **fluent-ffmpeg**: 2.1.3 - Audio processing
- **spotify-web-api-node**: 5.0.2 - Spotify API integration

### Database
- **Primary**: SQLite with Prisma ORM
- **Models**: FileCache, KeyValueCache, Setting, FavoriteQuery
- **Migrations**: Located in `/migrations/` directory

### Development Tools
- **Linting**: ESLint with XO configuration
- **Type Checking**: TypeScript strict mode
- **Testing**: npm test (runs linting)
- **Git Hooks**: Husky for pre-commit hooks
- **Release Management**: release-it

## Project Structure

```
muse/
├── src/
│   ├── bot.ts                 # Main bot class with Discord client setup
│   ├── index.ts               # Application entry point
│   ├── inversify.config.ts    # Dependency injection configuration
│   ├── types.ts               # TypeScript type definitions
│   ├── commands/              # Discord slash commands
│   │   ├── index.ts           # Command interface definition
│   │   ├── play.ts            # Play command (main functionality)
│   │   ├── queue.ts           # Queue management
│   │   ├── config.ts          # Bot configuration
│   │   └── [20+ other commands]
│   ├── services/              # Business logic services
│   │   ├── config.ts          # Configuration management
│   │   ├── player.ts          # Audio player service
│   │   ├── add-query-to-queue.ts # Queue management
│   │   ├── get-songs.ts       # Song retrieval
│   │   ├── youtube-api.ts     # YouTube integration
│   │   ├── spotify-api.ts     # Spotify integration
│   │   ├── file-cache.ts      # File caching system
│   │   └── key-value-cache.ts # Key-value caching
│   ├── managers/              # High-level managers
│   │   └── player.ts          # Player state management
│   ├── events/                # Discord event handlers
│   │   ├── guild-create.ts    # New guild setup
│   │   └── voice-state-update.ts # Voice channel events
│   ├── utils/                 # Utility functions
│   │   ├── db.ts              # Database utilities
│   │   ├── debug.ts           # Debug logging
│   │   ├── constants.ts       # Application constants
│   │   └── [15+ other utilities]
│   └── scripts/               # Startup and maintenance scripts
│       ├── start.ts           # Development startup
│       ├── migrate-and-start.ts # Production startup with migrations
│       └── run-with-database-url.ts # Database URL configuration
├── migrations/                # Prisma database migrations
├── .github/                   # GitHub Actions workflows
├── schema.prisma              # Database schema definition
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── Dockerfile                 # Multi-stage Docker build
└── [configuration files]
```

## Architecture

### Design Patterns
- **Dependency Injection**: Uses Inversify for IoC container
- **Command Pattern**: Discord slash commands as injectable services
- **Service Layer**: Business logic separated from Discord interaction
- **Repository Pattern**: Prisma ORM for data access
- **Caching Strategy**: File-based and key-value caching for performance

### Key Architectural Components

1. **Bot Class** (`src/bot.ts`): Main Discord client wrapper
2. **Command System**: Slash command handlers with auto-registration
3. **Service Layer**: Business logic for music operations
4. **Player Manager**: Audio playback state management
5. **Caching System**: Dual-layer caching (file + key-value)
6. **Database Layer**: Prisma ORM with SQLite

## Development Workflow

### Environment Setup
```bash
# Required environment variables
DISCORD_TOKEN=your_token_here
YOUTUBE_API_KEY=your_key_here
SPOTIFY_CLIENT_ID=your_id_here    # Optional
SPOTIFY_CLIENT_SECRET=your_secret_here # Optional

# Optional configuration
CACHE_LIMIT=2GB
ENABLE_SPONSORBLOCK=true
BOT_STATUS=online
BOT_ACTIVITY_TYPE=LISTENING
BOT_ACTIVITY=music
```

### Development Commands
```bash
# Install dependencies
yarn install

# Development mode (with watch)
yarn dev

# Production build
yarn build

# Start production server
yarn start

# Linting
yarn lint
yarn lint:fix

# Type checking
yarn typecheck

# Database operations
yarn prisma:generate
yarn migrations:generate
yarn migrations:run

# Release
yarn release
```

### Build Process
1. **TypeScript Compilation**: `tsc` compiles to `dist/`
2. **Prisma Generation**: Database client generation
3. **Database Migration**: Automatic on production start
4. **Docker Build**: Multi-stage build for production

### Testing & Quality
- **Linting**: ESLint with XO TypeScript configuration
- **Type Checking**: Strict TypeScript compilation
- **Pre-commit Hooks**: Husky runs tests before commit
- **CI/CD**: GitHub Actions for lint, type-check, and publish

## Docker & Deployment

### Docker Images
- **Registry**: `ghcr.io/museofficial/muse`
- **Tags**: `:latest`, `:2`, `:2.1`, `:2.1.1`
- **Architectures**: AMD64, ARM64

### Production Deployment
```bash
# Docker run
docker run -it -v "$(pwd)/data":/data \
  -e DISCORD_TOKEN='' \
  -e YOUTUBE_API_KEY='' \
  ghcr.io/museofficial/muse:latest

# Docker Compose
# See README.md for compose configuration
```

## Key Configuration

### Bot Settings (per guild)
- Playlist limit (default: 50)
- Queue page size (default: 10)
- Auto-announce next song
- Volume reduction when people speak
- Default volume level

### Caching Configuration
- File cache limit (default: 2GB)
- Key-value cache for API responses
- Automatic cleanup on startup

## API Integrations

### YouTube API
- Video search and metadata
- Playlist extraction
- Duration and thumbnail retrieval

### Spotify API (Optional)
- Track/playlist/album conversion to YouTube
- Rich metadata extraction
- Authentication handling

### SponsorBlock (Optional)
- Automatic segment skipping
- Community-driven content filtering

## Common Development Tasks

### Adding New Commands
1. Create command file in `src/commands/`
2. Implement Command interface
3. Add to inversify.config.ts
4. Test with `yarn dev`

### Database Schema Changes
1. Modify `schema.prisma`
2. Run `yarn migrations:generate`
3. Apply with `yarn migrations:run`

### Service Development
1. Create service in `src/services/`
2. Add to dependency injection container
3. Inject into commands/managers as needed

### Configuration Changes
1. Update `src/services/config.ts`
2. Add environment variable
3. Update `.env.example`

## Performance Considerations

### Caching Strategy
- File-based caching for audio files
- Key-value caching for API responses
- Configurable cache limits

### Audio Processing
- FFmpeg for audio conversion
- Opus encoding for Discord voice
- Volume normalization

### Database Optimization
- SQLite for simplicity
- Prisma for type-safe queries
- Automatic migrations

## Security & Best Practices

### Environment Variables
- All secrets in environment variables
- No hardcoded tokens or keys
- Optional Spotify integration

### Docker Security
- Multi-stage builds
- Minimal base images
- Non-root user execution

### Code Quality
- Strict TypeScript configuration
- ESLint with XO rules
- Pre-commit hooks
- Automated CI/CD

## Release Process

1. Update CHANGELOG.md
2. Run `yarn release`
3. Push tags trigger GitHub Actions
4. Automatic Docker build and GitHub release
5. Multi-architecture image publishing

---

*This documentation reflects the current state of the Muse Discord music bot codebase as of the latest commit.*