import { EnvVarPort } from "../domain/ports/env-var.port";

export class ProcessEnvVarAdapter extends EnvVarPort {
  get(key: string): string | undefined {
    return process.env[key];
  }
}
