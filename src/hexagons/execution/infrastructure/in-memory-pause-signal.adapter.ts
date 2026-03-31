import { PauseSignalPort } from "../domain/ports/pause-signal.port";

export class InMemoryPauseSignalAdapter extends PauseSignalPort {
  private callback: (() => void) | null = null;

  register(callback: () => void): void {
    this.callback = callback;
  }

  dispose(): void {
    this.callback = null;
  }

  triggerPause(): void {
    if (this.callback) {
      this.callback();
    }
  }

  reset(): void {
    this.callback = null;
  }
}
