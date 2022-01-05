-- CreateTable
CREATE TABLE `FileCaches` (`hash` VARCHAR(255) UNIQUE PRIMARY KEY, `bytes` INTEGER, `accessedAt` DATETIME, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL);

-- CreateTable
CREATE TABLE `KeyValueCaches` (`key` VARCHAR(255) UNIQUE PRIMARY KEY, `value` TEXT, `expiresAt` DATETIME, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL);

-- CreateTable
CREATE TABLE `Settings` (`guildId` VARCHAR(255) UNIQUE PRIMARY KEY, `prefix` VARCHAR(255), `channel` VARCHAR(255), `finishedSetup` TINYINT(1) DEFAULT 0, `playlistLimit` INTEGER DEFAULT '50', `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL);

-- CreateTable
CREATE TABLE `Shortcuts` (`id` INTEGER PRIMARY KEY, `guildId` VARCHAR(255), `authorId` VARCHAR(255), `shortcut` VARCHAR(255), `command` VARCHAR(255), `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shortcuts_shortcut" ON "Shortcuts"("shortcut");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shortcuts_guild_id" ON "Shortcuts"("guildId");
