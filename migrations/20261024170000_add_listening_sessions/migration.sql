CREATE TABLE "ListeningSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "channelId" TEXT,
    "messageId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "endReason" TEXT,
    "recoveryPending" BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE "ListeningSessionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "length" REAL NOT NULL,
    "offset" REAL NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "status" TEXT NOT NULL,
    CONSTRAINT "ListeningSessionEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ListeningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ListeningSession_guildId_startedAt_idx" ON "ListeningSession"("guildId", "startedAt");
CREATE INDEX "ListeningSession_endedAt_idx" ON "ListeningSession"("endedAt");
CREATE INDEX "ListeningSession_recoveryPending_idx" ON "ListeningSession"("recoveryPending");
CREATE UNIQUE INDEX "ListeningSessionEntry_sessionId_position_key" ON "ListeningSessionEntry"("sessionId", "position");
