import winston from "winston";

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

winston.addColors({
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "blue",
});

const isProduction = process.env.NODE_ENV === "production";

export const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.printf(({ timestamp, level, message, stack }) => {
              return stack
                ? `${timestamp} ${level}: ${message}\n${stack}`
                : `${timestamp} ${level}: ${message}`;
            }),
          ),
    }),
  ],
});

export { default as winston } from "winston";
export type { Logger } from "winston";
