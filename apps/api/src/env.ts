import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { cleanEnv, port, str } from "envalid";

const here = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(here, "../../../packages/db/.env") });
config({ path: resolve(here, "../.env") });

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ["development", "test", "production"],
    default: "development",
  }),
  PORT: port({ default: 3001 }),
  DATABASE_URL: str({
    desc: "Postgres connection string",
    example: "postgresql://user:pass@localhost:5432/shareway?schema=public",
  }),
});
