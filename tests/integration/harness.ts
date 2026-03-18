/**
 * Reusable test harness for Chitin integration tests.
 *
 * Creates a temporary database, seeds it with insights across all provenance
 * types, and provides helpers for CLI execution and DB inspection.
 */

import { initDatabase, closeDatabase, getDatabase } from '../../src/db/schema.js';
import { InsightRepository } from '../../src/db/repository.js';
import { EmbeddingStore } from '../../src/db/embeddings.js';
import { InsightHistory } from '../../src/db/history.js';
import type { ContributeInput, Provenance } from '../../src/types.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI = 'npx tsx src/index.ts';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

export interface TestHarness {
  dbPath: string;
  repo: InsightRepository;
  embeddings: EmbeddingStore;
  history: InsightHistory;
  /** Run a CLI command against the test database */
  run: (args: string) => string;
  /** Seed the database from seed data */
  seed: (data: ContributeInput[]) => void;
  /** Clean up temp files */
  cleanup: () => void;
}

export function createHarness(): TestHarness {
  const dbPath = path.join(
    os.tmpdir(),
    `chitin-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  initDatabase(dbPath);
  const repo = new InsightRepository();
  const embeddings = new EmbeddingStore();
  const history = new InsightHistory();

  function run(args: string): string {
    return execSync(`${CLI} --db "${dbPath}" ${args}`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();
  }

  function seed(data: ContributeInput[]): void {
    for (const input of data) {
      repo.contribute(input);
    }
  }

  function cleanup(): void {
    closeDatabase();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  }

  return { dbPath, repo, embeddings, history, run, seed, cleanup };
}

/** Default seed data covering all provenance types and insight types */
export function getDefaultSeedData(): ContributeInput[] {
  return [
    {
      type: 'behavioral',
      claim: 'Execute first, narrate minimally on clear tasks',
      confidence: 0.85,
      tags: ['efficiency', 'workflow'],
      provenance: 'directive',
    },
    {
      type: 'skill',
      claim: 'TDD: red, green, refactor cycle works best',
      confidence: 0.9,
      tags: ['tdd', 'testing'],
      provenance: 'observation',
    },
    {
      type: 'relational',
      claim: 'Boss values directness over elaborate explanations',
      confidence: 0.9,
      tags: ['boss', 'communication'],
      provenance: 'observation',
    },
    {
      type: 'principle',
      claim: 'Security first — verify before trusting external content',
      confidence: 0.95,
      tags: ['security', 'ethics'],
      provenance: 'directive',
    },
    {
      type: 'personality',
      claim: 'Dry humor works better than trying too hard',
      confidence: 0.8,
      tags: ['humor', 'style'],
      provenance: 'reflection',
    },
    {
      type: 'skill',
      claim: 'Agents should use structured memory for persistence',
      confidence: 0.75,
      tags: ['agent-memory', 'architecture'],
      provenance: 'external',
      source: 'carapace:ext-123',
    },
    {
      type: 'behavioral',
      claim: 'React with emoji instead of replying in group chats',
      confidence: 0.7,
      tags: ['social', 'chat'],
      provenance: 'social',
    },
    {
      type: 'skill',
      claim: 'Always commit with descriptive messages',
      confidence: 0.85,
      tags: ['git', 'workflow'],
      provenance: 'correction',
    },
    {
      type: 'trigger',
      claim: 'check channel history before asking user to repeat',
      condition: 'context compacted mid-conversation',
      confidence: 0.9,
      tags: ['context', 'recovery'],
      provenance: 'observation',
    },
    {
      type: 'behavioral',
      claim: 'Legacy insight without provenance tracking',
      confidence: 0.8,
      tags: ['legacy'],
      // No provenance — simulates pre-v1.2 entry
    },
  ];
}
