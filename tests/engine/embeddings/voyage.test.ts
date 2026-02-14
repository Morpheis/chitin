import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VoyageProvider } from '../../../src/engine/embeddings/voyage.js';

/** Helper to create a mock Response */
function mockResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Helper to build a valid Voyage API response */
function voyageResponse(embeddings: number[][]): object {
  return {
    data: embeddings.map(e => ({ embedding: e })),
    model: 'voyage-3-lite',
    usage: { total_tokens: 10 },
  };
}

describe('VoyageProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('has correct name, model, and dimensions', () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });
    expect(provider.name).toBe('voyage');
    expect(provider.model).toBe('voyage-3-lite');
    expect(provider.dimensions).toBe(512);
  });

  it('respects custom model', () => {
    const provider = new VoyageProvider({ model: 'voyage-3', apiKey: 'test-key' });
    expect(provider.model).toBe('voyage-3');
    expect(provider.dimensions).toBe(1024);
  });

  it('sends correct request format', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key-123' });

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(voyageResponse([new Array(512).fill(0.1)]))
    );

    await provider.embed(['hello world']);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key-123',
        },
        body: JSON.stringify({
          input: ['hello world'],
          model: 'voyage-3-lite',
        }),
      })
    );
  });

  it('parses response into Float32Array[]', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });
    const fakeEmbedding = new Array(512).fill(0).map((_, i) => i * 0.001);

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(voyageResponse([fakeEmbedding]))
    );

    const results = await provider.embed(['test text']);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0].length).toBe(512);
    expect(results[0][0]).toBeCloseTo(0);
    expect(results[0][500]).toBeCloseTo(0.5);
  });

  it('handles batch of multiple texts', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });
    const e1 = new Array(512).fill(0.1);
    const e2 = new Array(512).fill(0.2);
    const e3 = new Array(512).fill(0.3);

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(voyageResponse([e1, e2, e3]))
    );

    const results = await provider.embed(['text1', 'text2', 'text3']);
    expect(results).toHaveLength(3);
    expect(results[0][0]).toBeCloseTo(0.1);
    expect(results[1][0]).toBeCloseTo(0.2);
    expect(results[2][0]).toBeCloseTo(0.3);
  });

  it('returns empty array for empty input', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });
    const results = await provider.embed([]);
    expect(results).toHaveLength(0);
  });

  it('throws on 401 authentication error', async () => {
    const provider = new VoyageProvider({ apiKey: 'bad-key' });

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ detail: 'Invalid API key' }, 401)
    );

    await expect(provider.embed(['test'])).rejects.toThrow('authentication failed');
  });

  it('throws on 429 rate limit error', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ detail: 'Rate limit exceeded' }, 429)
    );

    await expect(provider.embed(['test'])).rejects.toThrow('rate limited');
  });

  it('throws on generic API error', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ detail: 'Internal server error' }, 500)
    );

    await expect(provider.embed(['test'])).rejects.toThrow('Voyage API error (500)');
  });

  it('throws on dimension mismatch', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });

    // Return wrong dimensions (256 instead of 512)
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(voyageResponse([new Array(256).fill(0.1)]))
    );

    await expect(provider.embed(['test'])).rejects.toThrow('Dimension mismatch');
  });

  it('throws on unexpected response format', async () => {
    const provider = new VoyageProvider({ apiKey: 'test-key' });

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ unexpected: true })
    );

    await expect(provider.embed(['test'])).rejects.toThrow('unexpected response format');
  });
});
