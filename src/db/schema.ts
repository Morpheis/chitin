import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

let db: DatabaseType | null = null;

const CREATE_INSIGHTS = `
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('behavioral','personality','relational','principle','skill')),
  claim TEXT NOT NULL,
  reasoning TEXT,
  context TEXT,
  limitations TEXT,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reinforcement_count INTEGER NOT NULL DEFAULT 0,
  last_retrieved_at TEXT
);
`;

const CREATE_EMBEDDINGS = `
CREATE TABLE IF NOT EXISTS insight_embeddings (
  insight_id TEXT PRIMARY KEY REFERENCES insights(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL
);
`;

export function initDatabase(dbPath: string): void {
  if (db) {
    db.close();
    db = null;
  }

  db = new Database(dbPath);
  
  // Performance settings
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(CREATE_INSIGHTS);
  db.exec(CREATE_EMBEDDINGS);
}

export function getDatabase(): DatabaseType {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
