/*
  Warnings:

  - You are about to drop the column `roleId` on the `Setting` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "playlistLimit" INTEGER NOT NULL DEFAULT 50,
    "secondsToWaitAfterQueueEmpties" INTEGER NOT NULL DEFAULT 30,
    "leaveIfNoListeners" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" ("createdAt", "guildId", "leaveIfNoListeners", "playlistLimit", "secondsToWaitAfterQueueEmpties", "updatedAt") SELECT "createdAt", "guildId", "leaveIfNoListeners", "playlistLimit", "secondsToWaitAfterQueueEmpties", "updatedAt" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
