-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "prefix" TEXT NOT NULL,
    "channel" TEXT,
    "finishedSetup" BOOLEAN NOT NULL DEFAULT false,
    "playlistLimit" INTEGER NOT NULL DEFAULT 50,
    "announceSongs" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" ("channel", "createdAt", "finishedSetup", "guildId", "playlistLimit", "prefix", "updatedAt") SELECT "channel", "createdAt", "finishedSetup", "guildId", "playlistLimit", "prefix", "updatedAt" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
