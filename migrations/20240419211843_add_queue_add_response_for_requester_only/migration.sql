-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "playlistLimit" INTEGER NOT NULL DEFAULT 50,
    "secondsToWaitAfterQueueEmpties" INTEGER NOT NULL DEFAULT 30,
    "leaveIfNoListeners" BOOLEAN NOT NULL DEFAULT true,
    "queueAddResponseEphemeral" BOOLEAN NOT NULL DEFAULT false,
    "autoAnnounceNextSong" BOOLEAN NOT NULL DEFAULT false,
    "defaultVolume" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" ("autoAnnounceNextSong", "createdAt", "defaultVolume", "guildId", "leaveIfNoListeners", "playlistLimit", "secondsToWaitAfterQueueEmpties", "updatedAt") SELECT "autoAnnounceNextSong", "createdAt", "defaultVolume", "guildId", "leaveIfNoListeners", "playlistLimit", "secondsToWaitAfterQueueEmpties", "updatedAt" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
