import { PauseSignalPort } from "../domain/ports/pause-signal.port";

export class ProcessSignalPauseAdapter extends PauseSignalPort {
  private handler: (() => void) | null = null;

  register(callback: () => void): void {
    this.handler = callback;
    process.on("SIGINT", this.handler);
  }

  dispose(): void {
    if (this.handler) {
      process.removeListener("SIGINT", this.handler);
      this.handler = null;
    }
  }
}
