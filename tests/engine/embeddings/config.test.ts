import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEmbeddingConfig } from '../../../src/engine/embeddings/config.js';

describe('loadEmbeddingConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('defaults to voyage provider', () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    const config = loadEmbeddingConfig();
    expect(config.provider).toBe('voyage');
    expect(config.model).toBe('voyage-3-lite');
    expect(config.apiKey).toBe('test-voyage-key');
  });

  it('respects explicit provider name', () => {
    process.env.VOYAGE_API_KEY = 'my-key';
    const config = loadEmbeddingConfig('voyage');
    expect(config.provider).toBe('voyage');
  });

  it('respects explicit model name', () => {
    process.env.VOYAGE_API_KEY = 'my-key';
    const config = loadEmbeddingConfig('voyage', 'voyage-3');
    expect(config.model).toBe('voyage-3');
  });

  it('uses OPENAI_API_KEY for openai provider', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const config = loadEmbeddingConfig('openai');
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('text-embedding-3-small');
    expect(config.apiKey).toBe('sk-test');
  });

  it('throws on missing API key', () => {
    expect(() => loadEmbeddingConfig('voyage'))
      .toThrow('Missing API key for voyage: set VOYAGE_API_KEY');
  });

  it('throws on unknown provider', () => {
    expect(() => loadEmbeddingConfig('llama'))
      .toThrow("Unknown embedding provider: 'llama'");
  });

  it('includes supported providers in unknown provider error', () => {
    expect(() => loadEmbeddingConfig('bad'))
      .toThrow('Supported: voyage, openai');
  });
});
