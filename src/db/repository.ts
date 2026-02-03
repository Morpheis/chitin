import crypto from 'node:crypto';
import { getDatabase } from './schema.js';
import type { Insight, ContributeInput, UpdateInput, InsightType, INSIGHT_TYPES } from '../types.js';

interface InsightRow {
  id: string;
  type: string;
  claim: string;
  reasoning: string | null;
  context: string | null;
  limitations: string | null;
  confidence: number;
  tags: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  reinforcement_count: number;
  last_retrieved_at: string | null;
}

function rowToInsight(row: InsightRow): Insight {
  return {
    id: row.id,
    type: row.type as InsightType,
    claim: row.claim,
    reasoning: row.reasoning ?? undefined,
    context: row.context ?? undefined,
    limitations: row.limitations ?? undefined,
    confidence: row.confidence,
    tags: JSON.parse(row.tags),
    source: row.source ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reinforcementCount: row.reinforcement_count,
    lastRetrievedAt: row.last_retrieved_at ?? undefined,
  };
}

export interface ListOptions {
  types?: InsightType[];
  tags?: string[];
  minConfidence?: number;
}

export interface InsightStats {
  total: number;
  byType: Record<InsightType, number>;
  averageConfidence: number;
}

export class InsightRepository {
  contribute(input: ContributeInput): Insight {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const tags = JSON.stringify(input.tags ?? []);

    db.prepare(`
      INSERT INTO insights (id, type, claim, reasoning, context, limitations, confidence, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.claim,
      input.reasoning ?? null,
      input.context ?? null,
      input.limitations ?? null,
      input.confidence,
      tags,
      input.source ?? null,
    );

    return this.get(id)!;
  }

  get(id: string): Insight | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM insights WHERE id = ?').get(id) as InsightRow | undefined;
    return row ? rowToInsight(row) : null;
  }

  update(id: string, input: UpdateInput): Insight {
    const db = getDatabase();
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`Insight not found: ${id}`);
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.claim !== undefined) { fields.push('claim = ?'); values.push(input.claim); }
    if (input.reasoning !== undefined) { fields.push('reasoning = ?'); values.push(input.reasoning); }
    if (input.context !== undefined) { fields.push('context = ?'); values.push(input.context); }
    if (input.limitations !== undefined) { fields.push('limitations = ?'); values.push(input.limitations); }
    if (input.confidence !== undefined) { fields.push('confidence = ?'); values.push(input.confidence); }
    if (input.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(input.tags)); }
    if (input.source !== undefined) { fields.push('source = ?'); values.push(input.source); }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE insights SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.get(id)!;
  }

  archive(id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM insights WHERE id = ?').run(id);
  }

  reinforce(id: string): Insight {
    const db = getDatabase();
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`Insight not found: ${id}`);
    }

    db.prepare(`
      UPDATE insights 
      SET reinforcement_count = reinforcement_count + 1,
          last_retrieved_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    return this.get(id)!;
  }

  list(options?: ListOptions): Insight[] {
    const db = getDatabase();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.types && options.types.length > 0) {
      const placeholders = options.types.map(() => '?').join(', ');
      conditions.push(`type IN (${placeholders})`);
      params.push(...options.types);
    }

    if (options?.minConfidence !== undefined) {
      conditions.push('confidence >= ?');
      params.push(options.minConfidence);
    }

    if (options?.tags && options.tags.length > 0) {
      // Match any insight whose tags JSON array contains any of the requested tags
      const tagConditions = options.tags.map(() => "tags LIKE ?");
      conditions.push(`(${tagConditions.join(' OR ')})`);
      params.push(...options.tags.map(t => `%"${t}"%`));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM insights ${where} ORDER BY created_at DESC`).all(...params) as InsightRow[];

    return rows.map(rowToInsight);
  }

  stats(): InsightStats {
    const db = getDatabase();

    const total = (db.prepare('SELECT COUNT(*) as count FROM insights').get() as { count: number }).count;

    const typeCounts = db.prepare(
      'SELECT type, COUNT(*) as count FROM insights GROUP BY type'
    ).all() as { type: string; count: number }[];

    const byType: Record<string, number> = {
      behavioral: 0,
      personality: 0,
      relational: 0,
      principle: 0,
      skill: 0,
    };
    for (const row of typeCounts) {
      byType[row.type] = row.count;
    }

    const avgRow = db.prepare(
      'SELECT AVG(confidence) as avg FROM insights'
    ).get() as { avg: number | null };

    return {
      total,
      byType: byType as Record<InsightType, number>,
      averageConfidence: avgRow.avg ?? 0,
    };
  }
}
