CREATE TABLE "ListeningSessionMessage" (
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "messageId" TEXT,
    "afterMessageId" TEXT,
    "nonce" TEXT,
    PRIMARY KEY ("sessionId", "position"),
    CONSTRAINT "ListeningSessionMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ListeningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Republish existing recaps so their full history is visible without interaction.
UPDATE "ListeningSession" SET "recoveryPending" = true;
