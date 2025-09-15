const fs = require("fs");
const path = require("path");
const { createLogger, format, transports } = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");

function makeLogger(service) {
  const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, "../logs");
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const level = process.env.LOG_LEVEL || "info";
  const jsonConsole = process.env.LOG_JSON === "1";

  const consoleFmt = jsonConsole
    ? format.json()
    : format.combine(
        format.colorize(),
        format.timestamp(),
        format.printf(({ level, message, timestamp, ...meta }) => {
          const rest = Object.keys(meta).length
            ? ` ${JSON.stringify(meta)}`
            : "";
          return `${timestamp} ${level}: ${message}${rest}`;
        })
      );

  return createLogger({
    level,
    defaultMeta: { service },
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.splat(),
      format.json()
    ),
    transports: [
      new DailyRotateFile({
        dirname: LOG_DIR,
        filename: `%DATE%.${service}.log`,
        datePattern: "YYYY-MM-DD",
        zippedArchive: true,
        maxSize: "50m",
        maxFiles: "14d",
        level,
      }),
      new transports.Console({ format: consoleFmt }),
    ],
  });
}

module.exports = { makeLogger };
