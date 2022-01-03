import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const DATA_DIR = process.env.DATA_DIR;
const DATABASE_URL = process.env.DATABASE_URL;
const legacyDbPath = path.join(DATA_DIR, "db.sqlite");

const legacyDbExists = fs.existsSync(legacyDbPath);
if (legacyDbExists) {
  console.log("Legacy db found, migrating to new db");
  execSync(
    `DATABASE_URL=file:${DATA_DIR}/db.sqlite prisma migrate resolve --applied 20220101155430_migrate_from_sequelize`
  );
  const dbPath = path.join(DATA_DIR, "db2.sqlite");
  fs.renameSync(legacyDbPath, dbPath);
}

execSync(`DATABASE_URL=${DATABASE_URL} prisma migrate deploy`);
