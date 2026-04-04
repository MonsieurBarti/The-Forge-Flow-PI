import { randomUUID } from "node:crypto";
import { err, type Result } from "@kernel";
import {
  type AgentDispatchConfig,
  type AgentDispatchPort,
  getAgentCard,
  type ResolvedModel,
} from "@kernel/agents";
import type { LoggerPort } from "@kernel/ports";
import type { ModelProfileName } from "@kernel/schemas";
import { FixerOutputParser } from "../application/fixer-output-parser";
import { FixerError } from "../domain/errors/fixer.error";
import { FixerPort, type FixRequest, type FixResult } from "../domain/ports/fixer.port";
import { SEVERITY_RANK } from "../domain/schemas/review.schemas";

export class PiFixerAdapter extends FixerPort {
  private readonly parser = new FixerOutputParser();

  constructor(
    private readonly agentDispatch: AgentDispatchPort,
    private readonly promptLoader: (path: string) => string,
    private readonly modelResolver: (profile: ModelProfileName) => ResolvedModel,
    private readonly logger: LoggerPort,
    private readonly generateTaskId: () => string = randomUUID,
  ) {
    super();
  }

  async fix(request: FixRequest): Promise<Result<FixResult, FixerError>> {
    const card = getAgentCard("fixer");
    const template = this.promptLoader("prompts/fixer.md");

    // Sort findings by severity (critical first)
    const sorted = [...request.findings].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );

    const taskPrompt = template.replace("{{findings_json}}", JSON.stringify(sorted, null, 2));

    const model = this.modelResolver(card.defaultModelProfile);

    const config: AgentDispatchConfig = {
      taskId: this.generateTaskId(),
      sliceId: request.sliceId,
      agentType: "fixer",
      workingDirectory: request.workingDirectory,
      systemPrompt: card.identity,
      taskPrompt,
      model,
      tools: [...card.requiredTools],
      filePaths: [],
    };

    this.logger.debug("PiFixerAdapter: dispatching fixer agent", {
      taskId: config.taskId,
      sliceId: config.sliceId,
      findingCount: request.findings.length,
    });

    const dispatchResult = await this.agentDispatch.dispatch(config);
    if (!dispatchResult.ok) {
      return err(new FixerError(`Fixer agent dispatch failed: ${dispatchResult.error.message}`));
    }

    return this.parser.parse(dispatchResult.data.output, request.findings);
  }
}
