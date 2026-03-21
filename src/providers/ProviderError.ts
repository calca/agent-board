/**
 * Base error for provider-related failures.
 */
export class ProviderError extends Error {
  constructor(
    public readonly providerId: string,
    message: string,
  ) {
    super(`[${providerId}] ${message}`);
    this.name = 'ProviderError';
  }
}

/**
 * Thrown when `ProviderRegistry.register()` is called with an ID that
 * is already registered.
 */
export class DuplicateProviderError extends ProviderError {
  constructor(providerId: string) {
    super(providerId, `Provider "${providerId}" is already registered.`);
    this.name = 'DuplicateProviderError';
  }
}
