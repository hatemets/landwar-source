import * as dotenv from "dotenv";
import winston from "winston";
import { ServerEnv } from "./ServerEnv";
dotenv.config();

// Custom format to add severity tag based on log level
const addSeverityFormat = winston.format((info) => {
  return {
    ...info,
    severity: info.level,
  };
});

// Define your base/parent logger. Logs go to the console only.
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    addSeverityFormat(),
    winston.format.json(),
  ),
  defaultMeta: {
    service: "openfront",
    environment: ServerEnv.gameEnvName(),
  },
  transports: [new winston.transports.Console()],
});

// Export both the main logger and the child logger factory
export { logger };
