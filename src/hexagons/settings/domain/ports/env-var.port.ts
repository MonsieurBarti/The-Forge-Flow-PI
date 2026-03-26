export abstract class EnvVarPort {
  abstract get(key: string): string | undefined;
}
