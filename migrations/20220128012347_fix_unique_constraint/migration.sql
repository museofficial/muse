/*
  Warnings:

  - A unique constraint covering the columns `[guildId,name]` on the table `FavoriteQuery` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "FavoriteQuery_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteQuery_guildId_name_key" ON "FavoriteQuery"("guildId", "name");
