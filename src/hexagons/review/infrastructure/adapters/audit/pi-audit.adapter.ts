import { randomUUID } from "node:crypto";
import { err, ok, type Result } from "@kernel";
import {
  type AgentDispatchConfig,
  type AgentDispatchPort,
  getAgentCard,
  type ResolvedModel,
} from "@kernel/agents";
import type { LoggerPort } from "@kernel/ports";
import type { ModelProfileName } from "@kernel/schemas";
import { AuditError } from "../../../domain/errors/audit.error";
import { AuditPort } from "../../../domain/ports/audit.port";
import {
  type AuditReportProps,
  AuditReportSchema,
} from "../../../domain/schemas/completion.schemas";

const PROMPT_MAP: Record<string, string> = {
  "spec-reviewer": "prompts/audit-milestone-intent.md",
  "security-auditor": "prompts/audit-milestone-security.md",
};

export class PiAuditAdapter extends AuditPort {
  constructor(
    private readonly agentDispatch: AgentDispatchPort,
    private readonly promptLoader: (path: string) => string,
    private readonly modelResolver: (profile: ModelProfileName) => ResolvedModel,
    private readonly logger: LoggerPort,
    private readonly generateTaskId: () => string = randomUUID,
  ) {
    super();
  }

  async auditMilestone(params: {
    milestoneLabel: string;
    requirementsContent: string;
    diffContent: string;
    agentType: "spec-reviewer" | "security-auditor";
  }): Promise<Result<AuditReportProps, AuditError>> {
    const card = getAgentCard(params.agentType);
    const promptPath = PROMPT_MAP[params.agentType];
    const template = this.promptLoader(promptPath);

    const taskPrompt = template
      .replace("{{requirements_content}}", params.requirementsContent)
      .replace("{{diff_content}}", params.diffContent);

    const model = this.modelResolver(card.defaultModelProfile);

    const config: AgentDispatchConfig = {
      taskId: this.generateTaskId(),
      sliceId: params.milestoneLabel,
      agentType: params.agentType,
      workingDirectory: process.cwd(),
      systemPrompt: card.identity,
      taskPrompt,
      model,
      tools: [...card.requiredTools],
      filePaths: [],
    };

    this.logger.debug("PiAuditAdapter: dispatching audit agent", {
      taskId: config.taskId,
      agentType: params.agentType,
      milestoneLabel: params.milestoneLabel,
    });

    const dispatchResult = await this.agentDispatch.dispatch(config);
    if (!dispatchResult.ok) {
      return err(AuditError.dispatchFailed(params.agentType, dispatchResult.error));
    }

    // Parse structured JSON output
    try {
      const parsed = JSON.parse(dispatchResult.data.output);
      const report = AuditReportSchema.parse({ ...parsed, agentType: params.agentType });
      return ok(report);
    } catch {
      return err(AuditError.parseFailed(params.agentType, dispatchResult.data.output));
    }
  }
}
