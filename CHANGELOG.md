# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2022-01-21
### Changed
- Queue embeds are now more detailed and appear when resuming playback. Thanks @bokherus!

## [0.4.0] - 2022-01-17
### Added
- Playlists can now be shuffled as they are added to the queue, using the `shuffle` option to `play`.

## [0.3.2] - 2022-01-17
### Fixed
- The SQLite database path is now correctly generated on Windows

### Changed
- Track lookups no longer fail silently (error is returned and logged)

## [0.3.1] - 2022-01-06
### Fixed
- Prisma client and migrations are no longer broken in built Docker images

## [0.3.0] - 2022-01-05
### Changed
- Migrated from Sequelize to Prisma. (#456)
- Bumped dependencies

## [0.2.1] - 2021-12-18
### Added
- [release-it](https://www.npmjs.com/package/release-it): makes it easier to generate new tags and releases

## [0.2.0]
### Added
- A custom track limit can now be set when queueing playlists from Spotify (default stays at 50). See #370.

## [0.1.1]
### Fixed
- Fixes a race condition in the file cache service (see #420)

## [0.1.0]
### Added
- Initial release

[Unreleased]: https://github.com/codetheweb/muse/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/codetheweb/muse/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/codetheweb/muse/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/codetheweb/muse/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/codetheweb/muse/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/codetheweb/muse/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/codetheweb/muse/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/codetheweb/muse/releases/tag/v0.2.0
[0.1.1]: https://github.com/codetheweb/muse/releases/tag/v0.1.1
[0.1.0]: https://github.com/codetheweb/muse/releases/tag/v0.1.0
