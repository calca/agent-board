import { ITaskProvider } from './ITaskProvider';
import { DuplicateProviderError } from './ProviderError';
import { KanbanTask } from '../types/KanbanTask';

/** Resolved task with its owning provider. */
export interface ResolvedTask {
  provider: ITaskProvider;
  task: KanbanTask;
}

/**
 * Central registry of all `ITaskProvider` instances.
 * Third-party extensions can register providers via the extension
 * `exports` API.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ITaskProvider>();

  /**
   * Register a provider. Throws `DuplicateProviderError` if a provider
   * with the same `id` is already registered.
   */
  register(provider: ITaskProvider): void {
    if (this.providers.has(provider.id)) {
      throw new DuplicateProviderError(provider.id);
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
  get(id: string): ITaskProvider | undefined {
    return this.providers.get(id);
  }

  /** Return all registered providers sorted by `displayName`. */
  getAll(): ITaskProvider[] {
    return [...this.providers.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  /** Dispose every registered provider. */
  disposeAll(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
  }

  /**
   * Look up a task by its composite id (`providerId:nativeId`).
   *
   * Finds the provider whose `id` matches `task.providerId`, then
   * searches its task list for the matching composite id.
   * Returns the provider + task pair, or `undefined`.
   */
  async resolveTask(compositeId: string): Promise<ResolvedTask | undefined> {
    for (const provider of this.providers.values()) {
      const tasks = await provider.getTasks();
      const task = tasks.find(t => t.id === compositeId);
      if (task) {
        return { provider, task };
      }
    }
    return undefined;
  }
}
