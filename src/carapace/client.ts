/**
 * HTTP client for the Carapace AI API.
 * Handles authentication, request formatting, and error mapping.
 */

import type { CarapaceContribution, CarapaceContributionResponse } from './mapper.js';

export interface CarapaceConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface CarapaceQueryParams {
  question: string;
  context?: string;
  maxResults?: number;
  minConfidence?: number;
  domainTags?: string[];
}

export interface CarapaceQueryResponse {
  _meta: { source: string; trust: string; warning: string };
  results: CarapaceContributionResponse[];
  relatedDomains: string[];
  totalMatches: number;
  valueSignal: unknown;
}

export class CarapaceError extends Error {
  code: string;

  constructor(message: string, code = 'UNKNOWN') {
    super(message);
    this.name = 'CarapaceError';
    this.code = code;
  }
}

const DEFAULT_BASE_URL = 'https://carapaceai.com/api/v1';

export class CarapaceClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: CarapaceConfig) {
    if (!config.apiKey) {
      throw new CarapaceError('API key is required', 'MISSING_API_KEY');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async contribute(contribution: CarapaceContribution): Promise<Record<string, unknown>> {
    return this.request('POST', '/contributions', contribution, true);
  }

  async query(params: CarapaceQueryParams): Promise<CarapaceQueryResponse> {
    return this.request('POST', '/query', params, true);
  }

  async get(id: string): Promise<CarapaceContributionResponse> {
    return this.request('GET', `/contributions/${id}`, undefined, false);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (auth) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new CarapaceError(
        `Network error: ${(err as Error).message}`,
        'NETWORK_ERROR',
      );
    }

    const data = await response.json();

    if (!response.ok) {
      const errorBody = data as { error?: { code?: string; message?: string } };
      const code = errorBody?.error?.code ?? 'API_ERROR';
      const message = errorBody?.error?.message ?? `HTTP ${response.status}`;
      throw new CarapaceError(message, code);
    }

    return data as T;
  }
}
