import type { ErrorRequestHandler, RequestHandler } from "express";
import createHttpError, { isHttpError } from "http-errors";
import { Prisma } from "@repo/db";
import { logger } from "@repo/logger";
import { ZodError } from "@repo/validator";

type ErrorItem = {
  type: string;
  msg: string;
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(createHttpError(404, "Route not found"));
};

function redactBody(body: unknown) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...body, password: null };
  }

  return body;
}

function statusAndItems(err: unknown): { statusCode: number; items: ErrorItem[] } {
  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      items: err.issues.map((issue) => ({
        type: err.name,
        msg: issue.path.length
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message,
      })),
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return {
        statusCode: 409,
        items: [{ type: err.name, msg: "Resource already exists" }],
      };
    }

    if (err.code === "P2025") {
      return {
        statusCode: 404,
        items: [{ type: err.name, msg: "Resource not found" }],
      };
    }
  }

  if (isHttpError(err)) {
    return {
      statusCode: err.status || err.statusCode || 500,
      items: [
        {
          type: err.name,
          msg: err.expose ? err.message : "Internal server error",
        },
      ],
    };
  }

  if (err instanceof SyntaxError) {
    return {
      statusCode: 400,
      items: [{ type: err.name, msg: "Invalid JSON" }],
    };
  }

  return {
    statusCode: 500,
    items: [
      {
        type: err instanceof Error ? err.name : "Error",
        msg: "Internal server error",
      },
    ],
  };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const { statusCode, items } = statusAndItems(err);

  logger.error({
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : "Error",
    stack: err instanceof Error ? err.stack : undefined,
    method: req.method,
    path: req.originalUrl,
    params: req.params,
    query: req.query,
    body: redactBody(req.body),
  });

  res.status(statusCode).json({
    error: items.map((item) => ({
      type: item.type,
      msg: item.msg,
      method: req.method,
      path: req.originalUrl,
    })),
  });
};
