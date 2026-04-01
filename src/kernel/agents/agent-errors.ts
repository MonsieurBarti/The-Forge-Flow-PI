import { BaseDomainError } from "@kernel/errors/base-domain.error";

export class AgentValidationError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static identityTooLong(lineCount: number): AgentValidationError {
    return new AgentValidationError(
      "AGENT.IDENTITY_TOO_LONG",
      `Agent identity is ${lineCount} lines (max 30)`,
      { lineCount, maxLines: 30 },
    );
  }

  static methodologyDetected(matches: string[]): AgentValidationError {
    return new AgentValidationError(
      "AGENT.METHODOLOGY_DETECTED",
      `Agent identity contains methodology patterns: ${matches.join(", ")}`,
      { matches },
    );
  }

  static missingFreshReviewerRule(agentType: string): AgentValidationError {
    return new AgentValidationError(
      "AGENT.MISSING_FRESH_REVIEWER_RULE",
      `Review-capable agent "${agentType}" must have freshReviewerRule "must-not-be-executor"`,
      { agentType },
    );
  }

  static invalidFreshReviewerRule(agentType: string): AgentValidationError {
    return new AgentValidationError(
      "AGENT.INVALID_FRESH_REVIEWER_RULE",
      `Non-review agent "${agentType}" must have freshReviewerRule "none"`,
      { agentType },
    );
  }

  static noSkillsDeclared(agentType: string): AgentValidationError {
    return new AgentValidationError(
      "AGENT.NO_SKILLS_DECLARED",
      `Agent "${agentType}" must declare at least one skill`,
      { agentType },
    );
  }
}

export class AgentLoadError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static parseError(filePath: string, cause: string): AgentLoadError {
    return new AgentLoadError(
      "AGENT.PARSE_ERROR",
      `Failed to parse agent file ${filePath}: ${cause}`,
      { filePath, cause },
    );
  }

  static promptNotFound(filePath: string, promptPath: string): AgentLoadError {
    return new AgentLoadError(
      "AGENT.PROMPT_NOT_FOUND",
      `Agent file ${filePath} references nonexistent prompt: ${promptPath}`,
      { filePath, promptPath },
    );
  }

  static duplicateType(agentType: string, files: string[]): AgentLoadError {
    return new AgentLoadError(
      "AGENT.DUPLICATE_TYPE",
      `Agent type "${agentType}" defined in multiple files: ${files.join(", ")}`,
      { agentType, files },
    );
  }

  static noAgentFiles(dir: string): AgentLoadError {
    return new AgentLoadError("AGENT.NO_AGENT_FILES", `No *.agent.md files found in ${dir}`, {
      dir,
    });
  }

  static multipleErrors(causes: AgentLoadError[]): AgentLoadError {
    return new AgentLoadError(
      "AGENT.MULTIPLE_LOAD_ERRORS",
      `${causes.length} agent files failed to load:\n${causes.map((e) => `  - ${e.message}`).join("\n")}`,
      { errorCount: causes.length, errors: causes.map((e) => e.message) },
    );
  }
}

export class AgentRegistryError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static notLoaded(): AgentRegistryError {
    return new AgentRegistryError(
      "AGENT.REGISTRY_NOT_LOADED",
      "Agent registry accessed before initialization. Call initializeAgentRegistry() first.",
    );
  }

  static agentNotFound(agentType: string): AgentRegistryError {
    return new AgentRegistryError(
      "AGENT.NOT_FOUND",
      `No agent registered for type "${agentType}"`,
      { agentType },
    );
  }
}
