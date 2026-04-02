import { execFile } from "node:child_process";
import { GitHubError } from "@kernel/errors/github.error";
import { GitHubPort } from "@kernel/ports/github.port";
import {
  type PrFilter,
  type PullRequestConfig,
  type PullRequestInfo,
  PullRequestInfoSchema,
} from "@kernel/ports/github.schemas";
import { err, ok, type Result } from "@kernel/result";

const GH_PR_FIELDS = "number,title,url,state,headRefName,baseRefName,createdAt";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure helper: normalise raw `gh pr` JSON into a validated PullRequestInfo. */
export function transformPrJson(raw: Record<string, unknown>): PullRequestInfo {
  const normalised = {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: typeof raw.state === "string" ? raw.state.toLowerCase() : raw.state,
    head: raw.headRefName,
    base: raw.baseRefName,
    createdAt: raw.createdAt,
  };
  return PullRequestInfoSchema.parse(normalised);
}

/** Pure helper: classify a gh CLI error from stderr into a typed GitHubError. */
export function mapGhError(error: Error, stderr: string): GitHubError {
  const msg = stderr.trim() || error.message;
  if (msg.includes("no authentication") || msg.includes("authentication token"))
    return new GitHubError("AUTH_FAILED", msg);
  if (msg.includes("already exists") || msg.includes("pull request already exists"))
    return new GitHubError("ALREADY_EXISTS", msg);
  if (msg.includes("Could not resolve") || msg.includes("not found"))
    return new GitHubError("NOT_FOUND", msg);
  if (msg.includes("failed to http") || msg.includes("network"))
    return new GitHubError("NETWORK_ERROR", msg);
  return new GitHubError("COMMAND_FAILED", msg);
}

export class GhCliAdapter extends GitHubPort {
  constructor(private readonly cwd: string) {
    super();
  }

  private runGh(args: string[]): Promise<Result<string, GitHubError>> {
    return new Promise((resolve) => {
      execFile("gh", args, { cwd: this.cwd, encoding: "utf-8" }, (error, stdout, stderr) => {
        if (error) {
          resolve(err(mapGhError(error, stderr)));
          return;
        }
        resolve(ok(stdout));
      });
    });
  }

  async createPullRequest(
    config: PullRequestConfig,
  ): Promise<Result<PullRequestInfo, GitHubError>> {
    const args = [
      "pr",
      "create",
      "--title",
      config.title,
      "--body",
      config.body,
      "--head",
      config.head,
      "--base",
      config.base,
      "--json",
      GH_PR_FIELDS,
    ];
    if (config.draft === true) args.push("--draft");

    const result = await this.runGh(args);
    if (!result.ok) return result;

    let raw: unknown;
    try {
      raw = JSON.parse(result.data) as unknown;
    } catch (_parseError: unknown) {
      return err(new GitHubError("COMMAND_FAILED", "Failed to parse gh pr create output"));
    }

    if (!isRecord(raw)) {
      return err(new GitHubError("COMMAND_FAILED", "Unexpected gh pr create output shape"));
    }

    try {
      const info = transformPrJson(raw);
      return ok(info);
    } catch (_zodError: unknown) {
      return err(new GitHubError("COMMAND_FAILED", "Invalid pr data returned by gh"));
    }
  }

  async listPullRequests(filter?: PrFilter): Promise<Result<PullRequestInfo[], GitHubError>> {
    const args = ["pr", "list", "--json", GH_PR_FIELDS];

    const state = filter?.state ?? "open";
    args.push("--state", state);

    if (filter?.head !== undefined) args.push("--head", filter.head);
    if (filter?.base !== undefined) args.push("--base", filter.base);

    const result = await this.runGh(args);
    if (!result.ok) return result;

    let rawList: unknown;
    try {
      rawList = JSON.parse(result.data) as unknown;
    } catch (_parseError: unknown) {
      return err(new GitHubError("COMMAND_FAILED", "Failed to parse gh pr list output"));
    }

    if (!Array.isArray(rawList)) {
      return err(new GitHubError("COMMAND_FAILED", "Unexpected gh pr list output shape"));
    }

    const infos: PullRequestInfo[] = [];
    for (const item of rawList) {
      if (!isRecord(item)) continue;
      try {
        infos.push(transformPrJson(item));
      } catch (_zodError: unknown) {
        return err(new GitHubError("COMMAND_FAILED", "Invalid pr entry in gh pr list output"));
      }
    }

    return ok(infos);
  }

  async addComment(prNumber: number, body: string): Promise<Result<void, GitHubError>> {
    const result = await this.runGh(["pr", "comment", String(prNumber), "--body", body]);
    if (!result.ok) return result;
    return ok(undefined);
  }
}
