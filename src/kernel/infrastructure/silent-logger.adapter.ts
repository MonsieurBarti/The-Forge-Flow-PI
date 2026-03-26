import { LoggerPort } from "@kernel/ports/logger.port";

interface LogMessage {
  readonly level: "error" | "warn" | "info" | "debug";
  readonly message: string;
  readonly context: Record<string, unknown> | undefined;
}

export class SilentLoggerAdapter extends LoggerPort {
  private messages: LogMessage[] = [];

  error(message: string, context?: Record<string, unknown>): void {
    this.messages.push({ level: "error", message, context });
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.messages.push({ level: "warn", message, context });
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.messages.push({ level: "info", message, context });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.messages.push({ level: "debug", message, context });
  }

  getMessages(): readonly LogMessage[] {
    return [...this.messages];
  }

  reset(): void {
    this.messages = [];
  }
}
