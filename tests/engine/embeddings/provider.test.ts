import { describe, it, expect } from 'vitest';
import type { EmbeddingProvider } from '../../../src/engine/embeddings/provider.js';

/** Mock provider to verify the interface contract */
class MockProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly model = 'mock-v1';
  readonly dimensions = 4;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(this.dimensions).fill(0.25));
  }
}

describe('EmbeddingProvider interface', () => {
  it('exposes name, model, and dimensions', () => {
    const provider = new MockProvider();
    expect(provider.name).toBe('mock');
    expect(provider.model).toBe('mock-v1');
    expect(provider.dimensions).toBe(4);
  });

  it('embed returns one Float32Array per input text', async () => {
    const provider = new MockProvider();
    const results = await provider.embed(['hello', 'world', 'test']);

    expect(results).toHaveLength(3);
    for (const vec of results) {
      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(4);
    }
  });

  it('embed handles empty input', async () => {
    const provider = new MockProvider();
    const results = await provider.embed([]);
    expect(results).toHaveLength(0);
  });

  it('each vector has the declared dimensions', async () => {
    const provider = new MockProvider();
    const [vec] = await provider.embed(['test']);
    expect(vec.length).toBe(provider.dimensions);
  });
});
