import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

let db: DatabaseType | null = null;

const CREATE_INSIGHTS = `
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('behavioral','personality','relational','principle','skill','trigger')),
  claim TEXT NOT NULL,
  reasoning TEXT,
  context TEXT,
  limitations TEXT,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  condition TEXT,
  avoid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reinforcement_count INTEGER NOT NULL DEFAULT 0,
  last_retrieved_at TEXT
);
`;

// Migration: add trigger support to existing databases
const MIGRATE_ADD_TRIGGER_FIELDS = `
ALTER TABLE insights ADD COLUMN condition TEXT;
`;

const MIGRATE_ADD_AVOID_FIELD = `
ALTER TABLE insights ADD COLUMN avoid INTEGER NOT NULL DEFAULT 0;
`;

// Update CHECK constraint (SQLite doesn't support ALTER CHECK, so we recreate)
const MIGRATE_UPDATE_TYPE_CHECK = `
-- SQLite doesn't allow modifying CHECK constraints directly.
-- For existing databases, we'll allow the insert/update and handle validation in code.
`;

const CREATE_EMBEDDINGS = `
CREATE TABLE IF NOT EXISTS insight_embeddings (
  insight_id TEXT PRIMARY KEY REFERENCES insights(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL
);
`;

const CREATE_HISTORY = `
CREATE TABLE IF NOT EXISTS insight_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_type TEXT NOT NULL CHECK(change_type IN ('create','update','reinforce','merge')),
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT
);
`;

const CREATE_HISTORY_INDEX = `
CREATE INDEX IF NOT EXISTS idx_history_insight_id ON insight_history(insight_id);
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
  db.exec(CREATE_HISTORY);
  db.exec(CREATE_HISTORY_INDEX);

  // Migrations for trigger support
  try {
    db.exec(MIGRATE_ADD_TRIGGER_FIELDS);
  } catch (e: any) {
    // Column already exists, ignore
    if (!e.message.includes('duplicate column')) throw e;
  }
  
  try {
    db.exec(MIGRATE_ADD_AVOID_FIELD);
  } catch (e: any) {
    // Column already exists, ignore
    if (!e.message.includes('duplicate column')) throw e;
  }

  // Migrate CHECK constraint to include 'trigger' type
  // SQLite doesn't support ALTER CHECK, so we recreate the table
  migrateToTriggerSupport(db);
}

function migrateToTriggerSupport(db: DatabaseType): void {
  // Check if migration is needed by trying to insert a test trigger
  const needsMigration = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name='insights'
  `).get() as { sql: string } | undefined;
  
  if (!needsMigration || needsMigration.sql.includes("'trigger'")) {
    return; // Already migrated or new database
  }

  // Perform migration
  db.exec(`
    -- Create new table with updated CHECK constraint
    CREATE TABLE insights_new (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('behavioral','personality','relational','principle','skill','trigger')),
      claim TEXT NOT NULL,
      reasoning TEXT,
      context TEXT,
      limitations TEXT,
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT,
      condition TEXT,
      avoid INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      reinforcement_count INTEGER NOT NULL DEFAULT 0,
      last_retrieved_at TEXT
    );

    -- Copy data from old table
    INSERT INTO insights_new (id, type, claim, reasoning, context, limitations, confidence, tags, source, condition, avoid, created_at, updated_at, reinforcement_count, last_retrieved_at)
    SELECT id, type, claim, reasoning, context, limitations, confidence, tags, source, 
           COALESCE(condition, NULL), COALESCE(avoid, 0), created_at, updated_at, reinforcement_count, last_retrieved_at
    FROM insights;

    -- Drop old table
    DROP TABLE insights;

    -- Rename new table
    ALTER TABLE insights_new RENAME TO insights;
  `);
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
