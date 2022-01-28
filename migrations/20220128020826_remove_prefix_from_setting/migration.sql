/*
  Warnings:

  - You are about to drop the column `finishedSetup` on the `Setting` table. All the data in the column will be lost.
  - You are about to drop the column `prefix` on the `Setting` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT,
    "playlistLimit" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" ("channel", "createdAt", "guildId", "playlistLimit", "updatedAt") SELECT "channel", "createdAt", "guildId", "playlistLimit", "updatedAt" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
