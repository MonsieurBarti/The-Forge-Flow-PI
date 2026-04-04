import type { Result } from "@kernel/result";
import { BaseDomainError } from "@kernel/errors";

export type HookErrorCode = "HOOK_DIR_NOT_FOUND" | "PERMISSION_DENIED" | "WRITE_FAILED";

export class HookError extends BaseDomainError {
  readonly code: string;
  constructor(code: HookErrorCode, message: string) {
    super(message);
    this.code = `HOOK.${code}`;
  }
}

export abstract class GitHookPort {
  abstract installPostCheckoutHook(scriptContent: string): Promise<Result<void, HookError>>;
  abstract isPostCheckoutHookInstalled(): Promise<Result<boolean, HookError>>;
  abstract uninstallPostCheckoutHook(): Promise<Result<void, HookError>>;
}
