import { EnvVarPort } from "../domain/ports/env-var.port";

export class InMemoryEnvVarAdapter extends EnvVarPort {
  private store = new Map<string, string>();

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  seed(key: string, value: string): void {
    this.store.set(key, value);
  }

  reset(): void {
    this.store.clear();
  }
}
