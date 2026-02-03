import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../../src/db/schema.js';
import { InsightRepository } from '../../src/db/repository.js';
import { InsightHistory, type HistoryEntry } from '../../src/db/history.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('InsightHistory', () => {
  let dbPath: string;
  let repo: InsightRepository;
  let history: InsightHistory;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initDatabase(dbPath);
    repo = new InsightRepository();
    history = new InsightHistory();
  });

  afterEach(() => {
    closeDatabase();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  describe('schema', () => {
    it('insight_history table exists after init', () => {
      const db = getDatabase();
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='insight_history'"
      ).all();
      expect(tables).toHaveLength(1);
    });
  });

  describe('auto-recording via repository', () => {
    it('contribute auto-records a create event', () => {
      const insight = repo.contribute({
        type: 'behavioral',
        claim: 'Test insight',
        confidence: 0.8,
      });

      const entries = history.getHistory(insight.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].changeType).toBe('create');
      expect(entries[0].field).toBe('*');
      expect(entries[0].newValue).toBe('Test insight');
    });

    it('update auto-records field-level events', () => {
      const insight = repo.contribute({
        type: 'behavioral',
        claim: 'Original claim',
        confidence: 0.8,
      });

      repo.update(insight.id, {
        claim: 'Updated claim',
        confidence: 0.95,
      });

      const entries = history.getHistory(insight.id);
      // 1 create + 2 update fields
      expect(entries).toHaveLength(3);
      
      const updates = entries.filter(e => e.changeType === 'update');
      expect(updates).toHaveLength(2);

      const claimChange = updates.find(e => e.field === 'claim');
      expect(claimChange).toBeTruthy();
      expect(claimChange!.oldValue).toBe('Original claim');
      expect(claimChange!.newValue).toBe('Updated claim');

      const confChange = updates.find(e => e.field === 'confidence');
      expect(confChange).toBeTruthy();
      expect(confChange!.oldValue).toBe('0.8');
      expect(confChange!.newValue).toBe('0.95');
    });

    it('reinforce auto-records confidence change', () => {
      const insight = repo.contribute({
        type: 'behavioral',
        claim: 'Test',
        confidence: 0.8,
      });

      repo.reinforce(insight.id);

      const entries = history.getHistory(insight.id);
      // 1 create + 1 reinforce
      expect(entries).toHaveLength(2);
      
      const reinforceEntry = entries.find(e => e.changeType === 'reinforce');
      expect(reinforceEntry).toBeTruthy();
      expect(reinforceEntry!.field).toBe('confidence');
      expect(reinforceEntry!.oldValue).toBe('0.8');
      expect(parseFloat(reinforceEntry!.newValue!)).toBeGreaterThan(0.8);
      expect(reinforceEntry!.source).toBe('reinforce:1');
    });

    it('merge auto-records field changes', () => {
      const target = repo.contribute({ type: 'behavioral', claim: 'A', confidence: 0.8 });
      const source = repo.contribute({ type: 'behavioral', claim: 'B', confidence: 0.9 });
      const sourceId = source.id;

      repo.merge(source.id, target.id);

      const entries = history.getHistory(target.id);
      const mergeEntries = entries.filter(e => e.changeType === 'merge');
      expect(mergeEntries.length).toBeGreaterThan(0);
      expect(mergeEntries.every(e => e.source === `merge:${sourceId}`)).toBe(true);
    });
  });

  describe('getHistory', () => {
    it('returns entries in chronological order', () => {
      const insight = repo.contribute({
        type: 'behavioral',
        claim: 'Test',
        confidence: 0.8,
      });

      // contribute auto-records create. Now reinforce and update.
      repo.reinforce(insight.id);
      repo.update(insight.id, { claim: 'Updated' });

      const entries = history.getHistory(insight.id);
      expect(entries).toHaveLength(3); // create + reinforce + update
      expect(entries[0].changeType).toBe('create');
      expect(entries[1].changeType).toBe('reinforce');
      expect(entries[2].changeType).toBe('update');
    });

    it('returns empty array for unknown insight', () => {
      const entries = history.getHistory('nonexistent');
      expect(entries).toHaveLength(0);
    });

    it('limits results', () => {
      const insight = repo.contribute({ type: 'behavioral', claim: 'Test', confidence: 0.5 });
      
      // Create several history entries
      for (let i = 0; i < 10; i++) {
        history.recordReinforce(insight.id, 0.5 + i * 0.01, 0.5 + (i + 1) * 0.01, i + 1);
      }

      const limited = history.getHistory(insight.id, { limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe('getChangelog', () => {
    it('returns recent changes across all insights', () => {
      const a = repo.contribute({ type: 'behavioral', claim: 'A', confidence: 0.8 });
      repo.contribute({ type: 'skill', claim: 'B', confidence: 0.7 });

      // contribute auto-records create for both. Now reinforce one.
      repo.reinforce(a.id);

      const changelog = history.getChangelog({ limit: 10 });
      expect(changelog.length).toBe(3); // 2 creates + 1 reinforce
      // Most recent first
      expect(changelog[0].changeType).toBe('reinforce');
    });

    it('filters by days', () => {
      const a = repo.contribute({ type: 'behavioral', claim: 'A', confidence: 0.8 });
      history.recordCreate(a);

      // All entries are from "now", so days=1 should include them
      const recent = history.getChangelog({ days: 1 });
      expect(recent.length).toBeGreaterThan(0);
    });
  });
});
