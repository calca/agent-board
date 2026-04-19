import { GenAiProviderScope, IGenAiProvider } from './IGenAiProvider';

/**
 * Central registry of all `IGenAiProvider` instances.
 *
 * Global providers (VS Code Chat, GitHub Cloud, GitHub Copilot, VS Code API) are registered at
 * activation time.  Project-scoped providers are registered
 * per-project based on `.agent-board/config.json` or via the API.
 */
export class GenAiProviderRegistry {
  private readonly providers = new Map<string, IGenAiProvider>();

  /** Register a provider. Throws if a provider with the same id exists. */
  register(provider: IGenAiProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`GenAI provider "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
  }

  /** Remove a provider by id. Returns `true` if it existed. */
  unregister(id: string): boolean {
    const provider = this.providers.get(id);
    if (provider) {
      provider.dispose();
      this.providers.delete(id);
      return true;
    }
    return false;
  }

  /** Get a single provider by id, or `undefined`. */
  get(id: string): IGenAiProvider | undefined {
    return this.providers.get(id);
  }

  /** Return all registered providers sorted by `displayName`. */
  getAll(): IGenAiProvider[] {
    return [...this.providers.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  /** Return providers filtered by scope, sorted by `displayName`. */
  getByScope(scope: GenAiProviderScope): IGenAiProvider[] {
    return this.getAll().filter(p => p.scope === scope);
  }

  /** Return only providers that are currently available. */
  async getAvailable(): Promise<IGenAiProvider[]> {
    const all = this.getAll();
    const checks = await Promise.all(all.map(async p => ({ p, ok: await p.isAvailable() })));
    return checks.filter(c => c.ok).map(c => c.p);
  }

  /** Dispose every registered provider. */
  disposeAll(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
  }
}
