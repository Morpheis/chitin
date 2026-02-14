/**
 * EmbeddingProvider interface — the contract all embedding providers must implement.
 * 
 * Providers generate vector embeddings from text for semantic search.
 * Each provider wraps a specific API (Voyage AI, OpenAI, etc.).
 */
export interface EmbeddingProvider {
  /** Provider identifier, e.g. 'voyage', 'openai' */
  readonly name: string;

  /** Model identifier, e.g. 'voyage-3-lite', 'text-embedding-3-small' */
  readonly model: string;

  /** Output vector dimensions, e.g. 1024, 1536 */
  readonly dimensions: number;

  /**
   * Generate embeddings for a batch of texts.
   * Returns one Float32Array per input text, each of length `dimensions`.
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}
