import { LoggerPort } from "@kernel/ports/logger.port";

export class ConsoleLoggerAdapter extends LoggerPort {
  error(message: string, context?: Record<string, unknown>): void {
    context ? console.error(message, context) : console.error(message);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    context ? console.warn(message, context) : console.warn(message);
  }

  info(message: string, context?: Record<string, unknown>): void {
    context ? console.info(message, context) : console.info(message);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    context ? console.debug(message, context) : console.debug(message);
  }
}
