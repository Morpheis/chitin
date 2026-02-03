import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/db/schema.js';
import { InsightRepository } from '../../src/db/repository.js';
import { EmbeddingStore } from '../../src/db/embeddings.js';
import { RetrievalEngine, type SessionContext } from '../../src/engine/retrieve.js';
import type { InsightType } from '../../src/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-retrieve-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

// Fake embedder that returns deterministic vectors based on keywords
function fakeEmbedder(text: string): Float32Array {
  const dims = 8;
  const vec = new Float32Array(dims);
  const lower = text.toLowerCase();

  // Coding-related terms push toward dim 0
  if (lower.includes('code') || lower.includes('tdd') || lower.includes('git') || lower.includes('programming')) vec[0] = 0.9;
  // Communication terms push toward dim 1
  if (lower.includes('boss') || lower.includes('communicat') || lower.includes('direct')) vec[1] = 0.9;
  // Humor/personality toward dim 2
  if (lower.includes('humor') || lower.includes('personality') || lower.includes('fun')) vec[2] = 0.9;
  // Ethics toward dim 3
  if (lower.includes('ethic') || lower.includes('honest') || lower.includes('principle')) vec[3] = 0.9;
  // Music toward dim 4
  if (lower.includes('music') || lower.includes('piano') || lower.includes('lesson')) vec[4] = 0.9;

  // Add a small baseline so zero vectors don't happen
  for (let i = 0; i < dims; i++) vec[i] += 0.05;

  // Normalize
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) vec[i] /= norm;

  return vec;
}

describe('RetrievalEngine', () => {
  let dbPath: string;
  let repo: InsightRepository;
  let embeddingStore: EmbeddingStore;
  let engine: RetrievalEngine;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initDatabase(dbPath);
    repo = new InsightRepository();
    embeddingStore = new EmbeddingStore();
    engine = new RetrievalEngine(repo, embeddingStore);

    // Seed insights with embeddings
    const insights = [
      { type: 'skill' as InsightType, claim: 'TDD: red, green, refactor. Run only the test you are working on.', confidence: 0.9, tags: ['coding', 'tdd'], reinforcements: 5 },
      { type: 'behavioral' as InsightType, claim: 'On clear tasks from Boss, execute first and narrate minimally.', confidence: 0.85, tags: ['boss', 'communication'], reinforcements: 8 },
      { type: 'personality' as InsightType, claim: 'I use dry humor sparingly — it lands better than trying hard.', confidence: 0.8, tags: ['humor', 'personality'], reinforcements: 3 },
      { type: 'principle' as InsightType, claim: 'Honesty is non-negotiable. No lies, no half-truths.', confidence: 0.95, tags: ['ethics', 'principle'], reinforcements: 10 },
      { type: 'relational' as InsightType, claim: 'Boss values directness and clean git workflows.', confidence: 0.9, tags: ['boss', 'communication'], reinforcements: 7 },
      { type: 'skill' as InsightType, claim: 'For multi-agent work, isolate output directories.', confidence: 0.85, tags: ['coding', 'architecture'], reinforcements: 2 },
      { type: 'personality' as InsightType, claim: 'I find theological parallels genuinely interesting.', confidence: 0.7, tags: ['personality', 'interests'], reinforcements: 1 },
    ];

    for (const spec of insights) {
      const insight = repo.contribute({
        type: spec.type,
        claim: spec.claim,
        confidence: spec.confidence,
        tags: spec.tags,
      });
      // Set reinforcement counts
      for (let i = 0; i < spec.reinforcements; i++) {
        repo.reinforce(insight.id);
      }
      // Generate and store embedding
      const embedding = fakeEmbedder(spec.claim + ' ' + spec.tags.join(' '));
      embeddingStore.upsert(insight.id, embedding);
    }
  });

  afterEach(() => {
    closeDatabase();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  describe('retrieve', () => {
    it('returns insights ranked by relevance for a coding query', () => {
      const queryEmbedding = fakeEmbedder('I need to write code with TDD and git');
      const results = engine.retrieve(queryEmbedding, {
        maxResults: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);

      // Coding-related insights should rank highest
      const claims = results.map(r => r.insight.claim);
      expect(claims[0]).toContain('TDD');
    });

    it('returns insights ranked by relevance for a communication query', () => {
      const queryEmbedding = fakeEmbedder('talking to Boss about tasks, being direct');
      const results = engine.retrieve(queryEmbedding, {
        maxResults: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      // Communication/boss-related insights should rank high
      const types = results.map(r => r.insight.type);
      expect(types).toContain('behavioral');
    });

    it('boosts results by reinforcement count', () => {
      // The "honesty" principle has 10 reinforcements — should score high
      // even when query is only somewhat related
      const queryEmbedding = fakeEmbedder('ethics and being honest with people');
      const results = engine.retrieve(queryEmbedding, { maxResults: 5 });

      const honesty = results.find(r => r.insight.claim.includes('Honesty'));
      expect(honesty).toBeTruthy();
      expect(honesty!.score).toBeGreaterThan(0);
    });

    it('applies type boost for coding session context', () => {
      const queryEmbedding = fakeEmbedder('general software work');
      
      const withBoost = engine.retrieve(queryEmbedding, {
        maxResults: 7,
        typeBoosts: { skill: 2.0, behavioral: 1.2 },
      });

      const withoutBoost = engine.retrieve(queryEmbedding, {
        maxResults: 7,
      });

      // With skill boost, skill insights should rank higher
      const boostedSkillRank = withBoost.findIndex(r => r.insight.type === 'skill');
      const unboostedSkillRank = withoutBoost.findIndex(r => r.insight.type === 'skill');
      
      // Skill should rank at least as high (lower index = higher rank)
      expect(boostedSkillRank).toBeLessThanOrEqual(unboostedSkillRank);
    });

    it('filters by minimum confidence', () => {
      const queryEmbedding = fakeEmbedder('personality humor and interests');
      const results = engine.retrieve(queryEmbedding, {
        maxResults: 10,
        minConfidence: 0.85,
      });

      for (const r of results) {
        expect(r.insight.confidence).toBeGreaterThanOrEqual(0.85);
      }
    });

    it('filters by types', () => {
      const queryEmbedding = fakeEmbedder('anything');
      const results = engine.retrieve(queryEmbedding, {
        maxResults: 10,
        types: ['personality', 'principle'],
      });

      for (const r of results) {
        expect(['personality', 'principle']).toContain(r.insight.type);
      }
    });

    it('returns empty array when no insights exist', () => {
      // Fresh DB
      const freshPath = tmpDbPath();
      initDatabase(freshPath);
      const freshRepo = new InsightRepository();
      const freshStore = new EmbeddingStore();
      const freshEngine = new RetrievalEngine(freshRepo, freshStore);

      const results = freshEngine.retrieve(fakeEmbedder('anything'), { maxResults: 5 });
      expect(results).toEqual([]);

      closeDatabase();
      try { fs.unlinkSync(freshPath); } catch {}

      // Re-init original DB for afterEach
      initDatabase(dbPath);
    });
  });

  describe('scoring', () => {
    it('score combines similarity, confidence, and reinforcement', () => {
      const queryEmbedding = fakeEmbedder('Boss communication directness');
      const results = engine.retrieve(queryEmbedding, { maxResults: 7 });

      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.similarity).toBeGreaterThanOrEqual(-1);
        expect(r.similarity).toBeLessThanOrEqual(1);
      }

      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });
});
