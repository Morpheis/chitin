import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/db/schema.js';
import { InsightRepository } from '../../src/db/repository.js';
import { detectConflicts, computeTensionScore, type ConflictResult } from '../../src/engine/conflicts.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-conflicts-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('computeTensionScore', () => {
  it('detects tension between opposing terms', () => {
    const result = computeTensionScore(
      'Boss prefers detailed verbose explanations',
      'Boss values concise brief responses',
    );

    expect(result.score).toBeGreaterThan(0.3);
    expect(result.pairs.length).toBeGreaterThan(0);
  });

  it('returns zero tension for unrelated claims', () => {
    const result = computeTensionScore(
      'TDD means writing tests first',
      'Boss likes coffee in the morning',
    );

    expect(result.score).toBe(0);
    expect(result.pairs).toHaveLength(0);
  });

  it('returns zero tension for similar claims', () => {
    const result = computeTensionScore(
      'Boss values directness and efficiency',
      'Boss prefers direct communication style',
    );

    expect(result.score).toBe(0);
    expect(result.pairs).toHaveLength(0);
  });

  it('detects ask vs act tension', () => {
    const result = computeTensionScore(
      'Always ask before taking action',
      'Act first on clear tasks, explain later',
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.pairs.some(p =>
      (p[0] === 'ask' && p[1] === 'act') || (p[0] === 'act' && p[1] === 'ask')
    )).toBe(true);
  });

  it('detects formal vs casual tension', () => {
    const result = computeTensionScore(
      'Use formal professional tone in messages',
      'Keep it casual and relaxed',
    );

    expect(result.score).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    const result = computeTensionScore(
      'Be VERBOSE in explanations',
      'Keep things CONCISE',
    );

    expect(result.score).toBeGreaterThan(0);
  });
});

describe('detectConflicts', () => {
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

  it('detects conflict with existing insight', () => {
    repo.contribute({
      type: 'relational',
      claim: 'Boss values directness and brevity',
      confidence: 0.9,
      tags: ['boss', 'communication'],
    });

    const conflicts = detectConflicts(repo, {
      type: 'relational',
      claim: 'Boss prefers detailed verbose explanations',
      confidence: 0.7,
    });

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].tensionScore).toBeGreaterThan(0);
    expect(conflicts[0].tensionReason).toBeTruthy();
  });

  it('returns empty array when no conflicts', () => {
    repo.contribute({
      type: 'skill',
      claim: 'TDD means writing tests first',
      confidence: 0.9,
    });

    const conflicts = detectConflicts(repo, {
      type: 'relational',
      claim: 'Boss prefers morning standups',
      confidence: 0.7,
    });

    expect(conflicts).toHaveLength(0);
  });

  it('ranks conflicts by combined similarity and tension', () => {
    repo.contribute({
      type: 'behavioral',
      claim: 'Be verbose and detailed in all responses',
      confidence: 0.8,
    });
    repo.contribute({
      type: 'behavioral',
      claim: 'Explain everything thoroughly with examples',
      confidence: 0.7,
    });

    const conflicts = detectConflicts(repo, {
      type: 'behavioral',
      claim: 'Be concise and brief, skip unnecessary detail',
      confidence: 0.8,
    });

    // Should find at least the first one (direct tension: verbose ↔ concise)
    expect(conflicts.length).toBeGreaterThan(0);
    // Should be sorted by conflict score descending
    if (conflicts.length > 1) {
      expect(conflicts[0].conflictScore).toBeGreaterThanOrEqual(conflicts[1].conflictScore);
    }
  });

  it('includes both similarity and tension in results', () => {
    repo.contribute({
      type: 'behavioral',
      claim: 'Always ask permission before proceeding with tasks',
      confidence: 0.85,
    });

    const conflicts = detectConflicts(repo, {
      type: 'behavioral',
      claim: 'Act decisively on tasks without waiting',
      confidence: 0.8,
    });

    expect(conflicts.length).toBeGreaterThan(0);
    const c = conflicts[0];
    expect(c.similarity).toBeGreaterThanOrEqual(0);
    expect(c.tensionScore).toBeGreaterThan(0);
    expect(c.conflictScore).toBeGreaterThan(0);
    expect(c.tensionReason).toContain('↔');
  });

  it('respects minimum conflict score threshold', () => {
    repo.contribute({
      type: 'personality',
      claim: 'I enjoy debugging code',
      confidence: 0.7,
    });

    // Very low tension — should not flag at default threshold
    const conflicts = detectConflicts(repo, {
      type: 'personality',
      claim: 'I find testing more satisfying than debugging',
      confidence: 0.7,
    }, { minConflictScore: 0.8 });

    // With a very high threshold, marginal conflicts get filtered
    expect(conflicts).toHaveLength(0);
  });

  it('handles empty insight store', () => {
    const conflicts = detectConflicts(repo, {
      type: 'behavioral',
      claim: 'Act first on clear tasks',
      confidence: 0.8,
    });

    expect(conflicts).toHaveLength(0);
  });
});
