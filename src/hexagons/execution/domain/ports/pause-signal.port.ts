export abstract class PauseSignalPort {
  abstract register(callback: () => void): void;
  abstract dispose(): void;
}
