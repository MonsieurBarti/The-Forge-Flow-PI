export abstract class LoggerPort {
  abstract error(message: string, context?: Record<string, unknown>): void;
  abstract warn(message: string, context?: Record<string, unknown>): void;
  abstract info(message: string, context?: Record<string, unknown>): void;
  abstract debug(message: string, context?: Record<string, unknown>): void;
}
