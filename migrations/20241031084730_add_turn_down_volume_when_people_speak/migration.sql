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
    "defaultQueuePageSize" INTEGER NOT NULL DEFAULT 10,
    "turnDownVolumeWhenPeopleSpeak" BOOLEAN NOT NULL DEFAULT false,
    "turnDownVolumeWhenPeopleSpeakTarget" INTEGER NOT NULL DEFAULT 20,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" ("autoAnnounceNextSong", "createdAt", "defaultQueuePageSize", "defaultVolume", "guildId", "leaveIfNoListeners", "playlistLimit", "queueAddResponseEphemeral", "secondsToWaitAfterQueueEmpties", "updatedAt") SELECT "autoAnnounceNextSong", "createdAt", "defaultQueuePageSize", "defaultVolume", "guildId", "leaveIfNoListeners", "playlistLimit", "queueAddResponseEphemeral", "secondsToWaitAfterQueueEmpties", "updatedAt" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
