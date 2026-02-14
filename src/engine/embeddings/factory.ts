import type { EmbeddingProvider } from './provider.js';
import { VoyageProvider } from './voyage.js';

/**
 * Create an embedding provider by name.
 * 
 * @param name - Provider name ('voyage', future: 'openai')
 * @param options - Optional overrides for model and API key
 * @returns An EmbeddingProvider instance
 * @throws Error if provider name is unknown
 */
export function createProvider(
  name: string,
  options?: { model?: string; apiKey?: string }
): EmbeddingProvider {
  switch (name) {
    case 'voyage':
      if (!options?.apiKey) {
        throw new Error('Voyage provider requires an API key');
      }
      return new VoyageProvider({
        model: options?.model,
        apiKey: options.apiKey,
      });

    default:
      throw new Error(
        `Unknown embedding provider: '${name}'. Supported providers: voyage`
      );
  }
}
