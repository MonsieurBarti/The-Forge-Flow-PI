import type { Result } from "@kernel/result";
import { ok } from "@kernel/result";
import type { AgentCapability, AgentCard, AgentType } from "../schemas/agent-card.schema";
import type { AgentLoadError } from "../errors/agent-errors";
import { AgentRegistryError } from "../errors/agent-errors";
import type { AgentResourceLoader } from "./agent-resource-loader";

let _singleton: AgentRegistry | undefined;

export class AgentRegistry {
  private constructor(private readonly cards: ReadonlyMap<AgentType, AgentCard>) {}

  static fromCards(cards: Map<AgentType, AgentCard>): AgentRegistry {
    return new AgentRegistry(cards);
  }

  static loadFromResources(
    loader: AgentResourceLoader,
    resourceDir: string,
  ): Result<AgentRegistry, AgentLoadError> {
    const result = loader.loadAll(resourceDir);
    if (!result.ok) return result;
    return ok(AgentRegistry.fromCards(result.data));
  }

  get(type: AgentType): AgentCard | undefined {
    return this.cards.get(type);
  }

  getAll(): ReadonlyMap<AgentType, AgentCard> {
    return this.cards;
  }

  has(type: AgentType): boolean {
    return this.cards.has(type);
  }

  findByCapability(capability: AgentCapability): AgentCard[] {
    const result: AgentCard[] = [];
    for (const card of this.cards.values()) {
      if (card.capabilities.includes(capability)) result.push(card);
    }
    return result;
  }
}

function requireSingleton(): AgentRegistry {
  if (!_singleton) {
    throw AgentRegistryError.notLoaded();
  }
  return _singleton;
}

export function getAgentCard(type: AgentType): AgentCard {
  const card = requireSingleton().get(type);
  if (!card) {
    throw new Error(
      `[BUG] Missing registry entry for agent type "${type}". This is a programming error.`,
    );
  }
  return card;
}

export function findAgentsByCapability(capability: AgentCapability): AgentCard[] {
  return requireSingleton().findByCapability(capability);
}

export function initializeAgentRegistry(registry: AgentRegistry): void {
  _singleton = registry;
}

export function resetAgentRegistry(): void {
  _singleton = undefined;
}

export function isAgentRegistryInitialized(): boolean {
  return _singleton !== undefined;
}
