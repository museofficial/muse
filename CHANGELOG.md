# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Changed
- Migrated from Sequelize to Prisma. (#456)

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

[Unreleased]: https://github.com/codetheweb/muse/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/codetheweb/muse/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/codetheweb/muse/releases/tag/v0.2.0
[0.1.1]: https://github.com/codetheweb/muse/releases/tag/v0.1.1
[0.1.0]: https://github.com/codetheweb/muse/releases/tag/v0.1.0
