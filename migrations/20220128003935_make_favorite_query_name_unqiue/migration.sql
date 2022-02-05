/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `FavoriteQuery` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "FavoriteQuery_name_key" ON "FavoriteQuery"("name");
