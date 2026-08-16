import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { cleanEnv, str } from "envalid";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ["development", "test", "production"],
    default: "development",
  }),
  DATABASE_URL: str({
    desc: "Postgres connection string",
    example: "postgresql://user:pass@localhost:5432/shareway?schema=public",
  }),
});
