import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/db/schema.js';
import { InsightRepository } from '../../src/db/repository.js';
import { EmbeddingStore } from '../../src/db/embeddings.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-embed-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('EmbeddingStore', () => {
  let dbPath: string;
  let repo: InsightRepository;
  let store: EmbeddingStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initDatabase(dbPath);
    repo = new InsightRepository();
    store = new EmbeddingStore();
  });

  afterEach(() => {
    closeDatabase();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('stores and retrieves an embedding for an insight', () => {
    const insight = repo.contribute({
      type: 'behavioral',
      claim: 'Execute first, narrate minimally',
      confidence: 0.85,
    });

    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    store.upsert(insight.id, embedding);

    const retrieved = store.get(insight.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.length).toBe(5);
    expect(retrieved![0]).toBeCloseTo(0.1);
    expect(retrieved![4]).toBeCloseTo(0.5);
  });

  it('overwrites embedding on upsert', () => {
    const insight = repo.contribute({
      type: 'behavioral',
      claim: 'Test',
      confidence: 0.5,
    });

    store.upsert(insight.id, new Float32Array([1.0, 2.0]));
    store.upsert(insight.id, new Float32Array([3.0, 4.0]));

    const retrieved = store.get(insight.id);
    expect(retrieved![0]).toBeCloseTo(3.0);
    expect(retrieved![1]).toBeCloseTo(4.0);
  });

  it('returns null for non-existent embedding', () => {
    const result = store.get('non-existent');
    expect(result).toBeNull();
  });

  it('deletes embedding when insight is archived (FK cascade)', () => {
    const insight = repo.contribute({
      type: 'behavioral',
      claim: 'Test',
      confidence: 0.5,
    });

    store.upsert(insight.id, new Float32Array([1.0, 2.0]));
    expect(store.get(insight.id)).toBeTruthy();

    repo.archive(insight.id);
    expect(store.get(insight.id)).toBeNull();
  });

  it('computes cosine similarity correctly', () => {
    // Identical vectors → similarity 1.0
    const a = new Float32Array([1.0, 0.0, 0.0]);
    const b = new Float32Array([1.0, 0.0, 0.0]);
    expect(store.cosineSimilarity(a, b)).toBeCloseTo(1.0);

    // Orthogonal vectors → similarity 0.0
    const c = new Float32Array([1.0, 0.0, 0.0]);
    const d = new Float32Array([0.0, 1.0, 0.0]);
    expect(store.cosineSimilarity(c, d)).toBeCloseTo(0.0);

    // Opposite vectors → similarity -1.0
    const e = new Float32Array([1.0, 0.0]);
    const f = new Float32Array([-1.0, 0.0]);
    expect(store.cosineSimilarity(e, f)).toBeCloseTo(-1.0);
  });

  it('finds nearest neighbors by cosine similarity', () => {
    const i1 = repo.contribute({ type: 'behavioral', claim: 'Coding patterns', confidence: 0.8, tags: ['coding'] });
    const i2 = repo.contribute({ type: 'personality', claim: 'Dry humor', confidence: 0.7, tags: ['humor'] });
    const i3 = repo.contribute({ type: 'skill', claim: 'TDD workflow', confidence: 0.9, tags: ['coding'] });

    // Embeddings: i1 and i3 are similar (coding-related), i2 is different
    store.upsert(i1.id, new Float32Array([0.9, 0.1, 0.0]));
    store.upsert(i2.id, new Float32Array([0.0, 0.1, 0.9]));
    store.upsert(i3.id, new Float32Array([0.8, 0.2, 0.0]));

    const query = new Float32Array([1.0, 0.0, 0.0]); // coding-like query
    const results = store.findNearest(query, 2);

    expect(results).toHaveLength(2);
    expect(results[0].insightId).toBe(i1.id); // most similar
    expect(results[1].insightId).toBe(i3.id); // second most
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it('respects maxResults in findNearest', () => {
    for (let i = 0; i < 10; i++) {
      const insight = repo.contribute({ type: 'behavioral', claim: `Insight ${i}`, confidence: 0.5 });
      store.upsert(insight.id, new Float32Array([Math.random(), Math.random(), Math.random()]));
    }

    const query = new Float32Array([0.5, 0.5, 0.5]);
    const results = store.findNearest(query, 3);
    expect(results).toHaveLength(3);
  });

  it('returns IDs of insights missing embeddings', () => {
    const i1 = repo.contribute({ type: 'behavioral', claim: 'Has embedding', confidence: 0.8 });
    const i2 = repo.contribute({ type: 'personality', claim: 'No embedding', confidence: 0.7 });
    const i3 = repo.contribute({ type: 'skill', claim: 'Also no embedding', confidence: 0.9 });

    store.upsert(i1.id, new Float32Array([0.1, 0.2]));

    const missing = store.findMissingEmbeddings();
    expect(missing).toHaveLength(2);
    expect(missing).toContain(i2.id);
    expect(missing).toContain(i3.id);
    expect(missing).not.toContain(i1.id);
  });
});
