import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "@kernel/result";
import { parse as parseYaml } from "yaml";
import { AgentLoadError } from "../errors/agent-errors";
import { type AgentCard, AgentCardSchema, type AgentType } from "../schemas/agent-card.schema";
import { AgentValidationService } from "./agent-validation.service";

interface Frontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): Result<Frontmatter, AgentLoadError> {
  const parts = content.split(/^---\s*$/m);
  // parts[0] is empty string before first ---
  // parts[1] is the YAML block
  // parts[2+] is the body
  if (parts.length < 3) {
    return err(AgentLoadError.parseError("<unknown>", "No frontmatter delimiters found"));
  }

  const yamlBlock = parts[1];
  const body = parts.slice(2).join("---").trim();

  let frontmatter: Record<string, unknown>;
  try {
    const parsed: unknown = parseYaml(yamlBlock);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return err(AgentLoadError.parseError("<unknown>", "Frontmatter did not parse to an object"));
    }
    frontmatter = parsed as Record<string, unknown>;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(AgentLoadError.parseError("<unknown>", message));
  }

  return ok({ frontmatter, body });
}

function loadSingleAgent(filePath: string, resourceDir: string): Result<AgentCard, AgentLoadError> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(AgentLoadError.parseError(filePath, message));
  }

  const parseResult = parseFrontmatter(content);
  if (!parseResult.ok) {
    // re-tag with the actual file path
    return err(AgentLoadError.parseError(filePath, parseResult.error.message));
  }

  const { frontmatter, body } = parseResult.data;

  // Map modelProfile → defaultModelProfile; set description = purpose; set identity = body
  const cardData: Record<string, unknown> = {
    ...frontmatter,
    defaultModelProfile: frontmatter.modelProfile,
    description: frontmatter.purpose,
    identity: body,
  };
  // Remove the raw modelProfile key so Zod doesn't choke on unknown fields (strip mode)
  delete cardData.modelProfile;

  const zodResult = AgentCardSchema.safeParse(cardData);
  if (!zodResult.success) {
    const issues = zodResult.error.issues.map((i) => i.message).join("; ");
    return err(AgentLoadError.parseError(filePath, issues));
  }

  const card = zodResult.data;

  // Verify all referenced prompt files exist
  for (const skill of card.skills) {
    const promptPath = join(resourceDir, skill.prompt);
    if (!existsSync(promptPath)) {
      return err(AgentLoadError.promptNotFound(filePath, skill.prompt));
    }
  }

  // Domain validation
  const validationService = new AgentValidationService();
  const validationResult = validationService.validate(card);
  if (!validationResult.ok) {
    return err(AgentLoadError.parseError(filePath, validationResult.error.message));
  }

  return ok(card);
}

export class AgentResourceLoader {
  loadAll(resourceDir: string): Result<Map<AgentType, AgentCard>, AgentLoadError> {
    const agentsDir = join(resourceDir, "agents");

    let files: string[];
    try {
      files = readdirSync(agentsDir).filter((f) => f.endsWith(".agent.md"));
    } catch {
      return err(AgentLoadError.noAgentFiles(agentsDir));
    }

    if (files.length === 0) {
      return err(AgentLoadError.noAgentFiles(agentsDir));
    }

    const errors: AgentLoadError[] = [];
    const cardEntries: Array<{ file: string; card: AgentCard }> = [];

    for (const file of files) {
      const filePath = join(agentsDir, file);
      const result = loadSingleAgent(filePath, resourceDir);
      if (!result.ok) {
        errors.push(result.error);
      } else {
        cardEntries.push({ file, card: result.data });
      }
    }

    // Check for duplicate types among successfully parsed cards
    const typeToFileNames = new Map<AgentType, string[]>();
    for (const { file, card } of cardEntries) {
      const existing = typeToFileNames.get(card.type) ?? [];
      existing.push(file);
      typeToFileNames.set(card.type, existing);
    }

    for (const [type, fileNames] of typeToFileNames) {
      if (fileNames.length > 1) {
        errors.push(AgentLoadError.duplicateType(type, fileNames));
      }
    }

    if (errors.length === 1) {
      return err(errors[0]);
    }

    if (errors.length > 1) {
      return err(AgentLoadError.multipleErrors(errors));
    }

    const map = new Map<AgentType, AgentCard>();
    for (const { card } of cardEntries) {
      map.set(card.type, card);
    }

    return ok(map);
  }
}
