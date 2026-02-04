import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CarapaceClient,
  type CarapaceConfig,
  CarapaceError,
} from '../../src/carapace/client.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeConfig(overrides: Partial<CarapaceConfig> = {}): CarapaceConfig {
  return {
    apiKey: 'sc_key_test1234',
    baseUrl: 'https://carapaceai.com/api/v1',
    ...overrides,
  };
}

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('CarapaceClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('creates client with config', () => {
      const client = new CarapaceClient(makeConfig());
      expect(client).toBeDefined();
    });

    it('throws if apiKey is missing', () => {
      expect(() => new CarapaceClient(makeConfig({ apiKey: '' }))).toThrow();
    });
  });

  describe('contribute', () => {
    it('sends POST to /contributions with auth', async () => {
      const responseBody = {
        id: 'new-uuid',
        claim: 'Test claim',
        confidence: 0.9,
      };
      mockFetch.mockResolvedValueOnce(mockResponse(responseBody, 201));

      const client = new CarapaceClient(makeConfig());
      const result = await client.contribute({
        claim: 'Test claim',
        confidence: 0.9,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://carapaceai.com/api/v1/contributions');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Authorization']).toBe('Bearer sc_key_test1234');
      expect(JSON.parse(opts.body)).toEqual({
        claim: 'Test claim',
        confidence: 0.9,
      });
      expect(result).toEqual(responseBody);
    });

    it('throws CarapaceError on API error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          { error: { code: 'DUPLICATE_CONTRIBUTION', message: 'Already exists' } },
          409,
        ),
      );

      const client = new CarapaceClient(makeConfig());
      await expect(client.contribute({ claim: 'Dupe', confidence: 0.5 })).rejects.toThrow(
        CarapaceError,
      );
    });

    it('includes error code in CarapaceError', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          { error: { code: 'DUPLICATE_CONTRIBUTION', message: 'Already exists' } },
          409,
        ),
      );

      const client = new CarapaceClient(makeConfig());
      try {
        await client.contribute({ claim: 'Dupe', confidence: 0.5 });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(CarapaceError);
        expect((e as CarapaceError).code).toBe('DUPLICATE_CONTRIBUTION');
      }
    });
  });

  describe('query', () => {
    it('sends POST to /query with auth', async () => {
      const responseBody = {
        _meta: { source: 'carapace', trust: 'unverified', warning: 'test' },
        results: [],
        relatedDomains: [],
        totalMatches: 0,
        valueSignal: null,
      };
      mockFetch.mockResolvedValueOnce(mockResponse(responseBody));

      const client = new CarapaceClient(makeConfig());
      const result = await client.query({ question: 'test query' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://carapaceai.com/api/v1/query');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Authorization']).toBe('Bearer sc_key_test1234');
      expect(result).toEqual(responseBody);
    });
  });

  describe('get', () => {
    it('sends GET to /contributions/:id without auth', async () => {
      const responseBody = { id: 'abc', claim: 'Test', confidence: 0.8 };
      mockFetch.mockResolvedValueOnce(mockResponse(responseBody));

      const client = new CarapaceClient(makeConfig());
      const result = await client.get('abc');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://carapaceai.com/api/v1/contributions/abc');
      expect(opts.method).toBe('GET');
      expect(opts.headers['Authorization']).toBeUndefined();
      expect(result).toEqual(responseBody);
    });
  });

  describe('network error handling', () => {
    it('wraps network errors in CarapaceError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const client = new CarapaceClient(makeConfig());
      await expect(client.query({ question: 'test' })).rejects.toThrow(CarapaceError);
    });
  });
});
