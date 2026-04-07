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
import { DocWriterError } from "../domain/errors/doc-writer.error";
import { type DocType, DocWriterPort } from "../domain/ports/doc-writer.port";

const PROMPT_MAP: Record<DocType, string> = {
  architecture: "prompts/map-architecture.md",
  conventions: "prompts/map-conventions.md",
  stack: "prompts/map-stack.md",
  concerns: "prompts/map-concerns.md",
};

export class PiDocWriterAdapter extends DocWriterPort {
  constructor(
    private readonly agentDispatch: AgentDispatchPort,
    private readonly promptLoader: (path: string) => string,
    private readonly modelResolver: (profile: ModelProfileName) => ResolvedModel,
    private readonly logger: LoggerPort,
    private readonly generateTaskId: () => string = randomUUID,
  ) {
    super();
  }

  async generateDoc(params: {
    docType: DocType;
    workingDirectory: string;
    existingContent?: string;
    diffContent?: string;
  }): Promise<Result<string, DocWriterError>> {
    const card = getAgentCard("tff-doc-writer");
    const promptPath = PROMPT_MAP[params.docType];
    let taskPrompt = this.promptLoader(promptPath);

    taskPrompt = taskPrompt.replace("{{working_directory}}", params.workingDirectory);
    taskPrompt = taskPrompt.replace("{{date}}", new Date().toISOString().slice(0, 10));

    if (params.existingContent) {
      taskPrompt = taskPrompt
        .replace("{{#existing_content}}", "")
        .replace("{{/existing_content}}", "")
        .replace("{{existing_content}}", params.existingContent);
    } else {
      taskPrompt = taskPrompt.replace(
        /\{\{#existing_content\}\}[\s\S]*?\{\{\/existing_content\}\}/,
        "",
      );
    }

    if (params.diffContent) {
      taskPrompt = taskPrompt
        .replace("{{#diff_content}}", "")
        .replace("{{/diff_content}}", "")
        .replace("{{diff_content}}", params.diffContent);
    } else {
      taskPrompt = taskPrompt.replace(/\{\{#diff_content\}\}[\s\S]*?\{\{\/diff_content\}\}/, "");
    }

    const model = this.modelResolver(card.defaultModelProfile);

    const config: AgentDispatchConfig = {
      taskId: this.generateTaskId(),
      sliceId: `map-codebase-${params.docType}`,
      agentType: "tff-doc-writer",
      workingDirectory: params.workingDirectory,
      systemPrompt: card.identity,
      taskPrompt,
      model,
      tools: [...card.requiredTools],
      filePaths: [],
    };

    this.logger.debug("PiDocWriterAdapter: dispatching doc-writer agent", {
      taskId: config.taskId,
      docType: params.docType,
    });

    const dispatchResult = await this.agentDispatch.dispatch(config);
    if (!dispatchResult.ok) {
      return err(DocWriterError.dispatchFailed(params.docType, dispatchResult.error));
    }

    const output = dispatchResult.data.output.trim();
    if (!output) {
      return err(DocWriterError.parseFailed(params.docType));
    }

    return ok(output);
  }
}
