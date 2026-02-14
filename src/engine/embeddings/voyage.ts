import type { EmbeddingProvider } from './provider.js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

/** Default model — cheapest, 512 dimensions, good for personality insights */
const DEFAULT_MODEL = 'voyage-3-lite';

/** Model → dimension mapping for known Voyage models */
const MODEL_DIMENSIONS: Record<string, number> = {
  'voyage-3-lite': 512,
  'voyage-3': 1024,
  'voyage-code-3': 1024,
};

/** Maximum texts per API request (Voyage limit is 128) */
const MAX_BATCH_SIZE = 128;

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
  model: string;
  usage: { total_tokens: number };
}

interface VoyageErrorResponse {
  detail?: string;
  message?: string;
}

export class VoyageProvider implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;

  constructor(options: { model?: string; apiKey: string }) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.apiKey = options.apiKey;

    const knownDimensions = MODEL_DIMENSIONS[this.model];
    if (knownDimensions) {
      this.dimensions = knownDimensions;
    } else {
      // Unknown model — default to 1024 but warn
      this.dimensions = 1024;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    // Split into batches if needed
    const allResults: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const batchResults = await this.embedBatch(batch);
      allResults.push(...batchResults);
    }

    return allResults;
  }

  private async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let detail = errorBody;
      try {
        const parsed = JSON.parse(errorBody) as VoyageErrorResponse;
        detail = parsed.detail ?? parsed.message ?? errorBody;
      } catch {
        // Use raw body
      }

      if (response.status === 429) {
        throw new Error(`Voyage API rate limited (429): ${detail}`);
      }
      if (response.status === 401) {
        throw new Error(`Voyage API authentication failed (401): check VOYAGE_API_KEY`);
      }
      throw new Error(`Voyage API error (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as VoyageEmbeddingResponse;

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Voyage API returned unexpected response format: missing data array');
    }

    // Convert number arrays to Float32Arrays and validate dimensions
    return data.data.map((item, index) => {
      const embedding = new Float32Array(item.embedding);
      if (embedding.length !== this.dimensions) {
        throw new Error(
          `Dimension mismatch for text ${index}: expected ${this.dimensions}, got ${embedding.length}`
        );
      }
      return embedding;
    });
  }
}
