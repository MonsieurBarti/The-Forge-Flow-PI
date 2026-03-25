import type { GitHubError } from "@kernel/errors";
import type { Result } from "@kernel/result";
import type { PrFilter, PullRequestConfig, PullRequestInfo } from "./github.schemas";

export abstract class GitHubPort {
  abstract createPullRequest(
    config: PullRequestConfig,
  ): Promise<Result<PullRequestInfo, GitHubError>>;
  abstract listPullRequests(filter?: PrFilter): Promise<Result<PullRequestInfo[], GitHubError>>;
  abstract addComment(prNumber: number, body: string): Promise<Result<void, GitHubError>>;
}
