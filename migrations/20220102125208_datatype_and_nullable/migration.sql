/*
  Warnings:

  - You are about to alter the column `finishedSetup` on the `Settings` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("tinyint(1)")` to `Boolean`.
  - Made the column `expiresAt` on table `KeyValueCaches` required. This step will fail if there are existing NULL values in that column.
  - Made the column `key` on table `KeyValueCaches` required. This step will fail if there are existing NULL values in that column.
  - Made the column `value` on table `KeyValueCaches` required. This step will fail if there are existing NULL values in that column.
  - Made the column `authorId` on table `Shortcuts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `command` on table `Shortcuts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `guildId` on table `Shortcuts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `id` on table `Shortcuts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `shortcut` on table `Shortcuts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `accessedAt` on table `FileCaches` required. This step will fail if there are existing NULL values in that column.
  - Made the column `bytes` on table `FileCaches` required. This step will fail if there are existing NULL values in that column.
  - Made the column `hash` on table `FileCaches` required. This step will fail if there are existing NULL values in that column.
  - Made the column `guildId` on table `Settings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `prefix` on table `Settings` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KeyValueCaches" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_KeyValueCaches" ("createdAt", "expiresAt", "key", "updatedAt", "value") SELECT "createdAt", "expiresAt", "key", "updatedAt", "value" FROM "KeyValueCaches";
DROP TABLE "KeyValueCaches";
ALTER TABLE "new_KeyValueCaches" RENAME TO "KeyValueCache";
CREATE TABLE "new_Shortcuts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shortcuts" ("authorId", "command", "createdAt", "guildId", "id", "shortcut", "updatedAt") SELECT "authorId", "command", "createdAt", "guildId", "id", "shortcut", "updatedAt" FROM "Shortcuts";
DROP TABLE "Shortcuts";
ALTER TABLE "new_Shortcuts" RENAME TO "Shortcut";
CREATE INDEX "shortcuts_shortcut" ON "Shortcut"("shortcut");
CREATE INDEX "shortcuts_guild_id" ON "Shortcut"("guildId");
CREATE TABLE "new_FileCaches" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "bytes" INTEGER NOT NULL,
    "accessedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FileCaches" ("accessedAt", "bytes", "createdAt", "hash", "updatedAt") SELECT "accessedAt", "bytes", "createdAt", "hash", "updatedAt" FROM "FileCaches";
DROP TABLE "FileCaches";
ALTER TABLE "new_FileCaches" RENAME TO "FileCache";
CREATE TABLE "new_Settings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "prefix" TEXT NOT NULL,
    "channel" TEXT,
    "finishedSetup" BOOLEAN NOT NULL DEFAULT false,
    "playlistLimit" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("channel", "createdAt", "finishedSetup", "guildId", "playlistLimit", "prefix", "updatedAt") SELECT "channel", "createdAt", coalesce("finishedSetup", false) AS "finishedSetup", "guildId", coalesce("playlistLimit", 50) AS "playlistLimit", "prefix", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE INDEX "Shortcut_guildId_shortcut_idx" ON "Shortcut"("guildId", "shortcut");