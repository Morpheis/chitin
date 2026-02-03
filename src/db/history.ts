import { getDatabase } from './schema.js';
import type { Insight } from '../types.js';

export interface HistoryEntry {
  id: number;
  insightId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changeType: 'create' | 'update' | 'reinforce' | 'merge';
  changedAt: string;
  source: string | null;
}

export interface HistoryOptions {
  limit?: number;
}

export interface ChangelogOptions {
  limit?: number;
  days?: number;
}

interface HistoryRow {
  id: number;
  insight_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  changed_at: string;
  source: string | null;
}

function rowToEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    insightId: row.insight_id,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    changeType: row.change_type as HistoryEntry['changeType'],
    changedAt: row.changed_at,
    source: row.source,
  };
}

export class InsightHistory {
  /**
   * Record an insight creation.
   */
  recordCreate(insight: Insight): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO insight_history (insight_id, field, old_value, new_value, change_type, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(insight.id, '*', null, insight.claim, 'create', null);
  }

  /**
   * Record field-level changes from an update.
   * @param changes - Map of field name to { old, new } string values
   */
  recordUpdate(insightId: string, changes: Record<string, { old: string; new: string }>): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO insight_history (insight_id, field, old_value, new_value, change_type, source)
      VALUES (?, ?, ?, ?, 'update', ?)
    `);

    for (const [field, { old: oldVal, new: newVal }] of Object.entries(changes)) {
      stmt.run(insightId, field, oldVal, newVal, null);
    }
  }

  /**
   * Record a reinforcement event (confidence change).
   */
  recordReinforce(insightId: string, oldConfidence: number, newConfidence: number, newCount: number): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO insight_history (insight_id, field, old_value, new_value, change_type, source)
      VALUES (?, ?, ?, ?, 'reinforce', ?)
    `).run(
      insightId,
      'confidence',
      String(oldConfidence),
      String(newConfidence),
      `reinforce:${newCount}`,
    );
  }

  /**
   * Record field changes from a merge operation.
   */
  recordMerge(targetId: string, sourceId: string, changes: Record<string, { old: string; new: string }>): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO insight_history (insight_id, field, old_value, new_value, change_type, source)
      VALUES (?, ?, ?, ?, 'merge', ?)
    `);

    const source = `merge:${sourceId}`;
    for (const [field, { old: oldVal, new: newVal }] of Object.entries(changes)) {
      stmt.run(targetId, field, oldVal, newVal, source);
    }
  }

  /**
   * Get the history for a specific insight, in chronological order.
   */
  getHistory(insightId: string, options?: HistoryOptions): HistoryEntry[] {
    const db = getDatabase();
    const limit = options?.limit ? `LIMIT ${options.limit}` : '';
    const rows = db.prepare(`
      SELECT * FROM insight_history
      WHERE insight_id = ?
      ORDER BY changed_at ASC, id ASC
      ${limit}
    `).all(insightId) as HistoryRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Get recent changes across all insights, most recent first.
   */
  getChangelog(options?: ChangelogOptions): HistoryEntry[] {
    const db = getDatabase();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.days) {
      conditions.push(`changed_at >= datetime('now', ?)`);
      params.push(`-${options.days} days`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ? `LIMIT ${options.limit}` : 'LIMIT 50';

    const rows = db.prepare(`
      SELECT * FROM insight_history
      ${where}
      ORDER BY changed_at DESC, id DESC
      ${limit}
    `).all(...params) as HistoryRow[];

    return rows.map(rowToEntry);
  }
}
