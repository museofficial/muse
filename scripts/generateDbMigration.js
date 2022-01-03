import { execSync } from "child_process";
import dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

execSync(`DATABASE_URL=${DATABASE_URL} prisma migrate dev`);
