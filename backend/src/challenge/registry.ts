import type { ChallengeStrategyModule } from './types';
import { defaultChallengeStrategy } from './default-strategy';

export class ChallengeStrategyRegistry {
  private readonly strategies = new Map<string, ChallengeStrategyModule>();

  constructor() {
    this.register(defaultChallengeStrategy);
  }

  register(strategy: ChallengeStrategyModule): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(`Challenge strategy "${strategy.id}" is already registered.`);
    }
    this.strategies.set(strategy.id, strategy);
  }

  get(id: string): ChallengeStrategyModule | undefined {
    return this.strategies.get(id);
  }

  findByUrl(url: string): ChallengeStrategyModule {
    const hostname = new URL(url).hostname;
    const strategies = Array.from(this.strategies.values());
    return strategies.find((strategy) =>
      strategy.domains.some((domain) => domain !== '*' && (domain === hostname || hostname.endsWith(`.${domain}`)))
    ) ?? strategies.find((strategy) =>
      strategy.domains.some((domain) => domain === '*' || domain === hostname || hostname.endsWith(`.${domain}`))
    ) ?? defaultChallengeStrategy;
  }

  list(): Array<{ id: string; name?: string; domains: string[] }> {
    return Array.from(this.strategies.values()).map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      domains: strategy.domains,
    }));
  }
}

let globalChallengeStrategyRegistry: ChallengeStrategyRegistry | undefined;

export function getGlobalChallengeStrategyRegistry(): ChallengeStrategyRegistry {
  globalChallengeStrategyRegistry ??= new ChallengeStrategyRegistry();
  return globalChallengeStrategyRegistry;
}

export function resetGlobalChallengeStrategyRegistryForTests(): void {
  globalChallengeStrategyRegistry = new ChallengeStrategyRegistry();
}
