ALTER TABLE "Setting" ADD COLUMN "messageLogChannelId" TEXT;
ALTER TABLE "Setting" ADD COLUMN "logDeletedMessages" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Setting" ADD COLUMN "logEditedMessages" BOOLEAN NOT NULL DEFAULT true;
