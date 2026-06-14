ALTER TABLE "Setting" ADD COLUMN "welcomeChannelId" TEXT;
ALTER TABLE "Setting" ADD COLUMN "welcomeMessage" TEXT NOT NULL DEFAULT 'Welcome {user} to {server}.';
ALTER TABLE "Setting" ADD COLUMN "leaveChannelId" TEXT;
ALTER TABLE "Setting" ADD COLUMN "leaveMessage" TEXT NOT NULL DEFAULT '{user} has left the server. Go fuck yourself!';
