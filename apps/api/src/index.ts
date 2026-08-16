import { env } from "./env";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import { logger } from "@repo/logger";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { usersRouter } from "./routes/users";

const app = express();

app.use(cors());
app.use(express.json());
app.use(
  morgan("combined", {
    stream: {
      write: (message) => {
        logger.http(message.trim());
      },
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/users", usersRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});
