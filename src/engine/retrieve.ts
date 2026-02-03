import type { Insight, InsightType } from '../types.js';
import type { InsightRepository } from '../db/repository.js';
import type { EmbeddingStore } from '../db/embeddings.js';

export interface RetrieveOptions {
  maxResults?: number;
  minConfidence?: number;
  types?: InsightType[];
  typeBoosts?: Partial<Record<InsightType, number>>;
}

export interface ScoredInsight {
  insight: Insight;
  similarity: number;
  score: number;
}

export interface SessionContext {
  query: string;
  channel?: string;
  userId?: string;
  sessionType?: 'direct' | 'group' | 'subagent';
}

export class RetrievalEngine {
  private repo: InsightRepository;
  private embeddingStore: EmbeddingStore;

  constructor(repo: InsightRepository, embeddingStore: EmbeddingStore) {
    this.repo = repo;
    this.embeddingStore = embeddingStore;
  }

  /**
   * Retrieve relevant insights for a given query embedding.
   * 
   * Scoring formula:
   *   score = cosineSimilarity × confidence × log2(reinforcementCount + 2) × typeBoost
   * 
   * The +2 in the log avoids log(1)=0 for unreinforced insights while still
   * giving a meaningful boost to frequently-confirmed insights.
   */
  retrieve(queryEmbedding: Float32Array, options: RetrieveOptions = {}): ScoredInsight[] {
    const {
      maxResults = 15,
      minConfidence,
      types,
      typeBoosts = {},
    } = options;

    // Get all embeddings and compute similarities
    const nearest = this.embeddingStore.findNearest(queryEmbedding, 100);

    if (nearest.length === 0) return [];

    // Fetch the actual insights and score them
    const scored: ScoredInsight[] = [];

    for (const { insightId, similarity } of nearest) {
      const insight = this.repo.get(insightId);
      if (!insight) continue;

      // Apply filters
      if (minConfidence !== undefined && insight.confidence < minConfidence) continue;
      if (types && types.length > 0 && !types.includes(insight.type)) continue;

      // Compute composite score
      const reinforcementFactor = Math.log2(insight.reinforcementCount + 2);
      const typeBoost = typeBoosts[insight.type] ?? 1.0;

      const score = similarity * insight.confidence * reinforcementFactor * typeBoost;

      scored.push({ insight, similarity, score });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxResults);
  }
}
