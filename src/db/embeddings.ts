import { getDatabase } from './schema.js';

export interface NearestResult {
  insightId: string;
  similarity: number;
}

export interface EmbeddingMetadata {
  insightId: string;
  provider: string;
  model: string;
  dimensions: number;
  createdAt: string;
}

export class EmbeddingStore {
  upsert(insightId: string, embedding: Float32Array): void {
    const db = getDatabase();
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    db.prepare(`
      INSERT INTO insight_embeddings (insight_id, embedding)
      VALUES (?, ?)
      ON CONFLICT(insight_id) DO UPDATE SET embedding = excluded.embedding
    `).run(insightId, buffer);
  }

  get(insightId: string): Float32Array | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT embedding FROM insight_embeddings WHERE insight_id = ?'
    ).get(insightId) as { embedding: Buffer } | undefined;

    if (!row) return null;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  }

  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
  }

  findNearest(query: Float32Array, maxResults: number): NearestResult[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT insight_id, embedding FROM insight_embeddings'
    ).all() as { insight_id: string; embedding: Buffer }[];

    const scored: NearestResult[] = [];

    for (const row of rows) {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4
      );
      const similarity = this.cosineSimilarity(query, embedding);
      scored.push({ insightId: row.insight_id, similarity });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, maxResults);
  }

  findMissingEmbeddings(): string[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT i.id FROM insights i
      LEFT JOIN insight_embeddings e ON i.id = e.insight_id
      WHERE e.insight_id IS NULL
    `).all() as { id: string }[];

    return rows.map(r => r.id);
  }

  // --- Embedding Metadata ---

  /** Store or update metadata for an insight's embedding */
  upsertMetadata(insightId: string, provider: string, model: string, dimensions: number): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO embedding_metadata (insight_id, provider, model, dimensions)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(insight_id) DO UPDATE SET
        provider = excluded.provider,
        model = excluded.model,
        dimensions = excluded.dimensions,
        created_at = datetime('now')
    `).run(insightId, provider, model, dimensions);
  }

  /** Get metadata for a specific insight's embedding */
  getMetadata(insightId: string): EmbeddingMetadata | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT insight_id, provider, model, dimensions, created_at FROM embedding_metadata WHERE insight_id = ?'
    ).get(insightId) as { insight_id: string; provider: string; model: string; dimensions: number; created_at: string } | undefined;

    if (!row) return null;
    return {
      insightId: row.insight_id,
      provider: row.provider,
      model: row.model,
      dimensions: row.dimensions,
      createdAt: row.created_at,
    };
  }

  /** Get the dominant provider/model used across all embeddings (most common) */
  getActiveProviderInfo(): { provider: string; model: string; dimensions: number; count: number } | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT provider, model, dimensions, COUNT(*) as count
      FROM embedding_metadata
      GROUP BY provider, model
      ORDER BY count DESC
      LIMIT 1
    `).get() as { provider: string; model: string; dimensions: number; count: number } | undefined;

    return row ?? null;
  }

  /** Count how many insights have embeddings */
  countEmbeddings(): number {
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as count FROM insight_embeddings').get() as { count: number };
    return row.count;
  }

  /** Find insights whose metadata differs from the given provider/model (need re-encoding) */
  findMismatchedEmbeddings(provider: string, model: string): string[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT e.insight_id FROM insight_embeddings e
      JOIN embedding_metadata m ON e.insight_id = m.insight_id
      WHERE m.provider != ? OR m.model != ?
    `).all(provider, model) as { insight_id: string }[];

    return rows.map(r => r.insight_id);
  }

  /** Remove embedding and metadata for a specific insight */
  remove(insightId: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM insight_embeddings WHERE insight_id = ?').run(insightId);
    db.prepare('DELETE FROM embedding_metadata WHERE insight_id = ?').run(insightId);
  }

  /** Remove all embeddings and metadata */
  clearAll(): void {
    const db = getDatabase();
    db.prepare('DELETE FROM insight_embeddings').run();
    db.prepare('DELETE FROM embedding_metadata').run();
  }
}
