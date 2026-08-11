import fs from "node:fs";
import path from "node:path";

export type LogLevel = "info" | "warning" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  service: string;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

export interface FileLoggerOptions {
  logsDir: string;
  service?: string;
}

const LEVEL_DIRS: Record<LogLevel, string> = {
  info: "info",
  warning: "warning",
  error: "error",
};

/** Keys that must never appear in persisted log context (tokens, secrets). */
const REDACT_KEYS = /^(password|token|secret|authorization|cookie|api[_-]?key|session)$/i;

function redactContext(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input || Object.keys(input).length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (REDACT_KEYS.test(key)) {
      out[key] = "[redacted]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactContext(value as Record<string, unknown>) ?? "[object]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

function todayFileName(): string {
  return `${new Date().toISOString().slice(0, 10)}.log`;
}

export function ensureLogDirs(logsDir: string): void {
  fs.mkdirSync(logsDir, { recursive: true });
  for (const sub of Object.values(LEVEL_DIRS)) {
    fs.mkdirSync(path.join(logsDir, sub), { recursive: true });
  }
}

export function resolveLogFile(logsDir: string, level: LogLevel): string {
  return path.join(logsDir, LEVEL_DIRS[level], todayFileName());
}

export function createFileLogger(options: FileLoggerOptions) {
  const logsDir = path.resolve(options.logsDir);
  const service = options.service ?? "personai-server";
  ensureLogDirs(logsDir);

  function write(level: LogLevel, message: string, context?: Record<string, unknown>, stack?: string): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      service,
      message,
      context: redactContext(context),
      ...(stack ? { stack } : {}),
    };
    const line = `${JSON.stringify(entry)}\n`;
    const filePath = resolveLogFile(logsDir, level);
    try {
      fs.appendFileSync(filePath, line, "utf-8");
    } catch (err) {
      // Last resort — never crash the app because logging failed.
      console.error("[file-logger] write failed:", err);
    }
  }

  return {
    logsDir,
    service,
    info(message: string, context?: Record<string, unknown>) {
      write("info", message, context);
    },
    warning(message: string, context?: Record<string, unknown>) {
      write("warning", message, context);
    },
    error(message: string, context?: Record<string, unknown>, err?: unknown) {
      const stack =
        err instanceof Error
          ? err.stack
          : typeof err === "string"
            ? err
            : undefined;
      write("error", message, context, stack);
    },
    log(level: LogLevel, message: string, context?: Record<string, unknown>, err?: unknown) {
      if (level === "info") this.info(message, context);
      else if (level === "warning") this.warning(message, context);
      else this.error(message, context, err);
    },
  };
}

export type FileLogger = ReturnType<typeof createFileLogger>;

let defaultLogger: FileLogger | null = null;

export function initFileLogger(options: FileLoggerOptions): FileLogger {
  defaultLogger = createFileLogger(options);
  return defaultLogger;
}

export function getFileLogger(): FileLogger {
  if (!defaultLogger) {
    throw new Error("File logger not initialized — call initFileLogger() first");
  }
  return defaultLogger;
}

/** Safe accessor for modules loaded before bootstrap. */
export function tryGetFileLogger(): FileLogger | null {
  return defaultLogger;
}

export function formatError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

export function registerProcessLogHandlers(logger: FileLogger): void {
  process.on("uncaughtException", (err) => {
    logger.error("uncaughtException", undefined, err);
    console.error("[personai] uncaughtException:", err);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandledRejection", undefined, reason);
    console.error("[personai] unhandledRejection:", reason);
  });
}
