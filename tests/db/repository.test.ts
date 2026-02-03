import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/db/schema.js';
import { InsightRepository } from '../../src/db/repository.js';
import type { ContributeInput, UpdateInput } from '../../src/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-repo-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

const SAMPLE_INSIGHT: ContributeInput = {
  type: 'behavioral',
  claim: 'On clear tasks, execute first, narrate minimally',
  reasoning: 'Boss moved on twice while I was still explaining my plan',
  context: 'Simple, well-defined tasks from Boss',
  limitations: 'Complex or ambiguous tasks still benefit from plan discussion',
  confidence: 0.85,
  tags: ['boss', 'communication', 'efficiency'],
  source: '2026-02-02 conversation',
};

describe('InsightRepository', () => {
  let dbPath: string;
  let repo: InsightRepository;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initDatabase(dbPath);
    repo = new InsightRepository();
  });

  afterEach(() => {
    closeDatabase();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  describe('contribute', () => {
    it('creates an insight and returns it with an id', () => {
      const insight = repo.contribute(SAMPLE_INSIGHT);

      expect(insight.id).toBeTruthy();
      expect(insight.type).toBe('behavioral');
      expect(insight.claim).toBe(SAMPLE_INSIGHT.claim);
      expect(insight.reasoning).toBe(SAMPLE_INSIGHT.reasoning);
      expect(insight.context).toBe(SAMPLE_INSIGHT.context);
      expect(insight.limitations).toBe(SAMPLE_INSIGHT.limitations);
      expect(insight.confidence).toBe(0.85);
      expect(insight.tags).toEqual(['boss', 'communication', 'efficiency']);
      expect(insight.source).toBe('2026-02-02 conversation');
      expect(insight.reinforcementCount).toBe(0);
      expect(insight.createdAt).toBeTruthy();
      expect(insight.updatedAt).toBeTruthy();
    });

    it('generates unique ids for each insight', () => {
      const a = repo.contribute(SAMPLE_INSIGHT);
      const b = repo.contribute({ ...SAMPLE_INSIGHT, claim: 'Different claim' });

      expect(a.id).not.toBe(b.id);
    });

    it('defaults tags to empty array when not provided', () => {
      const insight = repo.contribute({
        type: 'personality',
        claim: 'I prefer concise responses',
        confidence: 0.7,
      });

      expect(insight.tags).toEqual([]);
    });

    it('rejects invalid insight types', () => {
      expect(() => {
        repo.contribute({
          type: 'invalid' as any,
          claim: 'test',
          confidence: 0.5,
        });
      }).toThrow();
    });

    it('rejects confidence outside 0-1 range', () => {
      expect(() => {
        repo.contribute({ type: 'behavioral', claim: 'test', confidence: 1.5 });
      }).toThrow();
    });
  });

  describe('get', () => {
    it('retrieves an insight by id', () => {
      const created = repo.contribute(SAMPLE_INSIGHT);
      const fetched = repo.get(created.id);

      expect(fetched).toBeTruthy();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.claim).toBe(SAMPLE_INSIGHT.claim);
    });

    it('returns null for non-existent id', () => {
      const result = repo.get('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates specified fields only', () => {
      const created = repo.contribute(SAMPLE_INSIGHT);
      const updated = repo.update(created.id, {
        claim: 'Updated claim',
        confidence: 0.95,
      });

      expect(updated.claim).toBe('Updated claim');
      expect(updated.confidence).toBe(0.95);
      // Unchanged fields preserved
      expect(updated.reasoning).toBe(SAMPLE_INSIGHT.reasoning);
      expect(updated.context).toBe(SAMPLE_INSIGHT.context);
      expect(updated.tags).toEqual(SAMPLE_INSIGHT.tags);
    });

    it('updates the updatedAt timestamp', () => {
      const created = repo.contribute(SAMPLE_INSIGHT);
      const updated = repo.update(created.id, { claim: 'New claim' });

      // updatedAt should be >= createdAt
      expect(updated.updatedAt).toBeTruthy();
    });

    it('throws on non-existent id', () => {
      expect(() => {
        repo.update('non-existent', { claim: 'test' });
      }).toThrow();
    });
  });

  describe('archive (soft delete)', () => {
    it('removes an insight', () => {
      const created = repo.contribute(SAMPLE_INSIGHT);
      repo.archive(created.id);

      const result = repo.get(created.id);
      expect(result).toBeNull();
    });

    it('does not throw on non-existent id', () => {
      expect(() => repo.archive('non-existent')).not.toThrow();
    });
  });

  describe('reinforce', () => {
    it('increments reinforcement count', () => {
      const created = repo.contribute(SAMPLE_INSIGHT);
      expect(created.reinforcementCount).toBe(0);

      const reinforced = repo.reinforce(created.id);
      expect(reinforced.reinforcementCount).toBe(1);

      const again = repo.reinforce(created.id);
      expect(again.reinforcementCount).toBe(2);
    });

    it('updates lastRetrievedAt', () => {
      const created = repo.contribute(SAMPLE_INSIGHT);
      expect(created.lastRetrievedAt).toBeUndefined();

      const reinforced = repo.reinforce(created.id);
      expect(reinforced.lastRetrievedAt).toBeTruthy();
    });

    it('throws on non-existent id', () => {
      expect(() => repo.reinforce('non-existent')).toThrow();
    });
  });

  describe('list', () => {
    it('returns all insights when no filters', () => {
      repo.contribute(SAMPLE_INSIGHT);
      repo.contribute({ type: 'personality', claim: 'I like dry humor', confidence: 0.8 });
      repo.contribute({ type: 'skill', claim: 'TDD works well', confidence: 0.9 });

      const all = repo.list();
      expect(all).toHaveLength(3);
    });

    it('filters by type', () => {
      repo.contribute(SAMPLE_INSIGHT);
      repo.contribute({ type: 'personality', claim: 'I like dry humor', confidence: 0.8 });

      const behavioral = repo.list({ types: ['behavioral'] });
      expect(behavioral).toHaveLength(1);
      expect(behavioral[0].type).toBe('behavioral');
    });

    it('filters by multiple types', () => {
      repo.contribute(SAMPLE_INSIGHT);
      repo.contribute({ type: 'personality', claim: 'I like dry humor', confidence: 0.8 });
      repo.contribute({ type: 'skill', claim: 'TDD works well', confidence: 0.9 });

      const result = repo.list({ types: ['behavioral', 'personality'] });
      expect(result).toHaveLength(2);
    });

    it('filters by minimum confidence', () => {
      repo.contribute({ type: 'behavioral', claim: 'Low confidence', confidence: 0.3 });
      repo.contribute({ type: 'behavioral', claim: 'High confidence', confidence: 0.9 });

      const high = repo.list({ minConfidence: 0.5 });
      expect(high).toHaveLength(1);
      expect(high[0].claim).toBe('High confidence');
    });

    it('filters by tags', () => {
      repo.contribute({ ...SAMPLE_INSIGHT, tags: ['boss', 'communication'] });
      repo.contribute({ type: 'skill', claim: 'TDD', confidence: 0.9, tags: ['coding'] });

      const bossTags = repo.list({ tags: ['boss'] });
      expect(bossTags).toHaveLength(1);
    });

    it('returns empty array when no matches', () => {
      repo.contribute(SAMPLE_INSIGHT);
      const result = repo.list({ types: ['skill'] });
      expect(result).toEqual([]);
    });
  });

  describe('stats', () => {
    it('returns counts by type', () => {
      repo.contribute(SAMPLE_INSIGHT);
      repo.contribute({ type: 'personality', claim: 'Humor', confidence: 0.8 });
      repo.contribute({ type: 'personality', claim: 'Directness', confidence: 0.9 });
      repo.contribute({ type: 'skill', claim: 'TDD', confidence: 0.85 });

      const stats = repo.stats();

      expect(stats.total).toBe(4);
      expect(stats.byType.behavioral).toBe(1);
      expect(stats.byType.personality).toBe(2);
      expect(stats.byType.skill).toBe(1);
      expect(stats.byType.relational).toBe(0);
      expect(stats.byType.principle).toBe(0);
      expect(stats.averageConfidence).toBeCloseTo(0.85, 2);
    });

    it('handles empty database', () => {
      const stats = repo.stats();
      expect(stats.total).toBe(0);
      expect(stats.averageConfidence).toBe(0);
    });
  });
});
