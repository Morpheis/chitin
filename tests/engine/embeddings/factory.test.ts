import { describe, it, expect } from 'vitest';
import { createProvider } from '../../../src/engine/embeddings/factory.js';
import { VoyageProvider } from '../../../src/engine/embeddings/voyage.js';

describe('createProvider', () => {
  it('creates a VoyageProvider for "voyage"', () => {
    const provider = createProvider('voyage', { apiKey: 'test-key' });
    expect(provider).toBeInstanceOf(VoyageProvider);
    expect(provider.name).toBe('voyage');
    expect(provider.model).toBe('voyage-3-lite');
    expect(provider.dimensions).toBe(512);
  });

  it('passes custom model to VoyageProvider', () => {
    const provider = createProvider('voyage', { model: 'voyage-3', apiKey: 'test-key' });
    expect(provider.model).toBe('voyage-3');
  });

  it('throws on unknown provider', () => {
    expect(() => createProvider('unknown', { apiKey: 'key' }))
      .toThrow("Unknown embedding provider: 'unknown'");
  });

  it('throws when voyage API key is missing', () => {
    expect(() => createProvider('voyage'))
      .toThrow('requires an API key');
  });

  it('throws when voyage API key is explicitly undefined', () => {
    expect(() => createProvider('voyage', { apiKey: undefined }))
      .toThrow('requires an API key');
  });
});
