import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FileLogger } from "./file-logger.js";
import { formatError } from "./file-logger.js";

export function registerFastifyLogging(app: FastifyInstance, logger: FileLogger): void {
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode >= 500) {
      logger.error("HTTP 5xx response", {
        method: request.method,
        url: request.url,
        status: reply.statusCode,
      });
    } else if (reply.statusCode >= 400) {
      logger.warning("HTTP 4xx response", {
        method: request.method,
        url: request.url,
        status: reply.statusCode,
      });
    }
  });

  app.setNotFoundHandler((request, reply) => {
    logger.warning("Route not found", {
      method: request.method,
      url: request.url,
    });
    return reply.status(404).send({ error: "Not found" });
  });

  app.setErrorHandler((err, request, reply) => {
    const { message, stack } = formatError(err);
    const status =
      typeof (err as { statusCode?: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
    logger.error("Request handler error", {
      method: request.method,
      url: request.url,
      status,
      message,
    }, err);
    if (status >= 500) {
      return reply.status(status).send({ error: "Internal server error" });
    }
    return reply.status(status).send({
      error: message || "Request failed",
    });
  });
}

export function logRouteError(
  logger: FileLogger,
  request: FastifyRequest,
  err: unknown,
  status = 400,
): void {
  const level = status >= 500 ? "error" : "warning";
  logger.log(level, "Route error", {
    method: request.method,
    url: request.url,
    status,
    message: formatError(err).message,
  }, err);
}
