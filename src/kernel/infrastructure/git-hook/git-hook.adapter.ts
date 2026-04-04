import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { ok, err, type Result } from "@kernel/result";
import { GitHookPort, HookError } from "@kernel/ports/git-hook.port";

const BEGIN_MARKER = "# --- TFF-PI BEGIN (do not edit) ---";
const END_MARKER = "# --- TFF-PI END ---";
const SHEBANG = "#!/bin/sh";

export class GitHookAdapter extends GitHookPort {
  constructor(private readonly gitDir: string) {
    super();
  }

  async installPostCheckoutHook(scriptContent: string): Promise<Result<void, HookError>> {
    if (!existsSync(this.gitDir)) {
      return err(new HookError("HOOK_DIR_NOT_FOUND", `.git directory not found: ${this.gitDir}`));
    }

    const hooksDir = join(this.gitDir, "hooks");
    mkdirSync(hooksDir, { recursive: true });

    const hookPath = join(hooksDir, "post-checkout");
    let existing = "";
    if (existsSync(hookPath)) {
      existing = readFileSync(hookPath, "utf-8");
    }

    const cleaned = this.removeSection(existing);
    const section = `${BEGIN_MARKER}\n${scriptContent}\n${END_MARKER}`;
    let content: string;
    if (!cleaned || cleaned.trim() === "") {
      content = `${SHEBANG}\n\n${section}\n`;
    } else if (!cleaned.startsWith("#!")) {
      content = `${SHEBANG}\n\n${cleaned.trimEnd()}\n\n${section}\n`;
    } else {
      content = `${cleaned.trimEnd()}\n\n${section}\n`;
    }

    try {
      writeFileSync(hookPath, content);
      chmodSync(hookPath, 0o755);
      return ok(undefined);
    } catch (e) {
      return err(new HookError("WRITE_FAILED", e instanceof Error ? e.message : String(e)));
    }
  }

  async isPostCheckoutHookInstalled(): Promise<Result<boolean, HookError>> {
    const hookPath = join(this.gitDir, "hooks", "post-checkout");
    if (!existsSync(hookPath)) return ok(false);
    const content = readFileSync(hookPath, "utf-8");
    return ok(content.includes(BEGIN_MARKER));
  }

  async uninstallPostCheckoutHook(): Promise<Result<void, HookError>> {
    const hookPath = join(this.gitDir, "hooks", "post-checkout");
    if (!existsSync(hookPath)) return ok(undefined);
    const content = readFileSync(hookPath, "utf-8");
    const cleaned = this.removeSection(content);
    writeFileSync(hookPath, cleaned);
    return ok(undefined);
  }

  private removeSection(content: string): string {
    const beginIdx = content.indexOf(BEGIN_MARKER);
    if (beginIdx === -1) return content;
    const endIdx = content.indexOf(END_MARKER);
    if (endIdx === -1) return content;
    const before = content.slice(0, beginIdx);
    const after = content.slice(endIdx + END_MARKER.length);
    return (before + after).replace(/\n{3,}/g, "\n\n");
  }
}
