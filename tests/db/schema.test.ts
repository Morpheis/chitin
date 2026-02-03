import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, getDatabase, closeDatabase } from '../../src/db/schema.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('Database Schema', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
  });

  afterEach(() => {
    closeDatabase();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('creates a new database with all tables', () => {
    initDatabase(dbPath);
    const db = getDatabase();

    // Check insights table exists
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('insights');
    expect(tableNames).toContain('insight_embeddings');
  });

  it('insights table has correct columns', () => {
    initDatabase(dbPath);
    const db = getDatabase();

    const columns = db.prepare("PRAGMA table_info(insights)").all() as { name: string; type: string; notnull: number }[];
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('type');
    expect(colNames).toContain('claim');
    expect(colNames).toContain('reasoning');
    expect(colNames).toContain('context');
    expect(colNames).toContain('limitations');
    expect(colNames).toContain('confidence');
    expect(colNames).toContain('tags');
    expect(colNames).toContain('source');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(colNames).toContain('reinforcement_count');
    expect(colNames).toContain('last_retrieved_at');
  });

  it('insight_embeddings table has correct columns', () => {
    initDatabase(dbPath);
    const db = getDatabase();

    const columns = db.prepare("PRAGMA table_info(insight_embeddings)").all() as { name: string }[];
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('insight_id');
    expect(colNames).toContain('embedding');
  });

  it('enforces valid insight types via CHECK constraint', () => {
    initDatabase(dbPath);
    const db = getDatabase();

    expect(() => {
      db.prepare(
        "INSERT INTO insights (id, type, claim, confidence, tags) VALUES (?, ?, ?, ?, ?)"
      ).run('test-1', 'invalid_type', 'test claim', 0.5, '[]');
    }).toThrow();
  });

  it('enforces confidence range via CHECK constraint', () => {
    initDatabase(dbPath);
    const db = getDatabase();

    expect(() => {
      db.prepare(
        "INSERT INTO insights (id, type, claim, confidence, tags) VALUES (?, ?, ?, ?, ?)"
      ).run('test-1', 'behavioral', 'test claim', 1.5, '[]');
    }).toThrow();

    expect(() => {
      db.prepare(
        "INSERT INTO insights (id, type, claim, confidence, tags) VALUES (?, ?, ?, ?, ?)"
      ).run('test-2', 'behavioral', 'test claim', -0.1, '[]');
    }).toThrow();
  });

  it('sets default values for reinforcement_count and timestamps', () => {
    initDatabase(dbPath);
    const db = getDatabase();

    db.prepare(
      "INSERT INTO insights (id, type, claim, confidence, tags) VALUES (?, ?, ?, ?, ?)"
    ).run('test-1', 'behavioral', 'test claim', 0.8, '["test"]');

    const row = db.prepare("SELECT * FROM insights WHERE id = ?").get('test-1') as Record<string, unknown>;

    expect(row.reinforcement_count).toBe(0);
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });

  it('is idempotent — calling initDatabase twice does not error', () => {
    initDatabase(dbPath);
    expect(() => initDatabase(dbPath)).not.toThrow();
  });

  it('enables WAL mode for performance', () => {
    initDatabase(dbPath);
    const db = getDatabase();

    const result = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(result.journal_mode).toBe('wal');
  });
});
