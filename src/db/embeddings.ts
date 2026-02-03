import { getDatabase } from './schema.js';

export interface NearestResult {
  insightId: string;
  similarity: number;
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
}
