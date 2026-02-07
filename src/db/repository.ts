import crypto from 'node:crypto';
import { getDatabase } from './schema.js';
import type { Insight, ContributeInput, ContributeResult, UpdateInput, InsightType, INSIGHT_TYPES } from '../types.js';
import { detectConflicts, type ConflictResult } from '../engine/conflicts.js';
import { InsightHistory } from './history.js';

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
  condition: string | null;
  avoid: number;
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
    condition: row.condition ?? undefined,
    avoid: row.avoid === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reinforcementCount: row.reinforcement_count,
    lastRetrievedAt: row.last_retrieved_at ?? undefined,
  };
}

export interface SimilarResult {
  insight: Insight;
  similarity: number;
}

export interface MergeOptions {
  claim?: string;  // Override the merged claim
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
  private history = new InsightHistory();

  contribute(input: ContributeInput): Insight {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const tags = JSON.stringify(input.tags ?? []);

    db.prepare(`
      INSERT INTO insights (id, type, claim, reasoning, context, limitations, confidence, tags, source, condition, avoid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.condition ?? null,
      input.avoid ? 1 : 0,
    );

    const insight = this.get(id)!;
    this.history.recordCreate(insight);
    return insight;
  }

  /**
   * Contribute with conflict detection. Checks for contradictions before writing.
   * Returns the new insight plus any detected conflicts.
   * 
   * If `force` is false and conflicts are found, the insight is STILL written
   * (caller decides what to do with conflict info). Use this for CLI interactive mode.
   */
  contributeWithCheck(input: ContributeInput, options?: { force?: boolean }): ContributeResult {
    const conflicts = options?.force ? [] : detectConflicts(this, input);
    const insight = this.contribute(input);
    return { insight, conflicts };
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
    const changes: Record<string, { old: string; new: string }> = {};

    if (input.claim !== undefined) {
      fields.push('claim = ?'); values.push(input.claim);
      if (input.claim !== existing.claim) changes.claim = { old: existing.claim, new: input.claim };
    }
    if (input.reasoning !== undefined) {
      fields.push('reasoning = ?'); values.push(input.reasoning);
      if (input.reasoning !== (existing.reasoning ?? '')) changes.reasoning = { old: existing.reasoning ?? '', new: input.reasoning };
    }
    if (input.context !== undefined) {
      fields.push('context = ?'); values.push(input.context);
      if (input.context !== (existing.context ?? '')) changes.context = { old: existing.context ?? '', new: input.context };
    }
    if (input.limitations !== undefined) {
      fields.push('limitations = ?'); values.push(input.limitations);
      if (input.limitations !== (existing.limitations ?? '')) changes.limitations = { old: existing.limitations ?? '', new: input.limitations };
    }
    if (input.confidence !== undefined) {
      fields.push('confidence = ?'); values.push(input.confidence);
      if (input.confidence !== existing.confidence) changes.confidence = { old: String(existing.confidence), new: String(input.confidence) };
    }
    if (input.tags !== undefined) {
      fields.push('tags = ?'); values.push(JSON.stringify(input.tags));
      const oldTags = JSON.stringify(existing.tags);
      const newTags = JSON.stringify(input.tags);
      if (oldTags !== newTags) changes.tags = { old: oldTags, new: newTags };
    }
    if (input.source !== undefined) {
      fields.push('source = ?'); values.push(input.source);
      if (input.source !== (existing.source ?? '')) changes.source = { old: existing.source ?? '', new: input.source };
    }
    if (input.condition !== undefined) {
      fields.push('condition = ?'); values.push(input.condition);
      if (input.condition !== (existing.condition ?? '')) changes.condition = { old: existing.condition ?? '', new: input.condition };
    }
    if (input.avoid !== undefined) {
      fields.push('avoid = ?'); values.push(input.avoid ? 1 : 0);
      if (input.avoid !== existing.avoid) changes.avoid = { old: String(existing.avoid), new: String(input.avoid) };
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE insights SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // Record history
    if (Object.keys(changes).length > 0) {
      this.history.recordUpdate(id, changes);
    }

    return this.get(id)!;
  }

  archive(id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM insights WHERE id = ?').run(id);
  }

  /**
   * Confidence adjustment rate per reinforcement.
   * Each reinforce nudges confidence up by this fraction of the remaining gap to 1.0:
   *   newConfidence = confidence + (1.0 - confidence) * CONFIDENCE_ADJUSTMENT_RATE
   * At 0.05, a 0.8 → 0.81 → 0.8195 → ... asymptotically approaching 1.0.
   */
  static readonly CONFIDENCE_ADJUSTMENT_RATE = 0.05;

  reinforce(id: string): Insight {
    const db = getDatabase();
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`Insight not found: ${id}`);
    }

    // Nudge confidence toward 1.0
    const oldConfidence = existing.confidence;
    const newConfidence = Math.min(
      1.0,
      oldConfidence + (1.0 - oldConfidence) * InsightRepository.CONFIDENCE_ADJUSTMENT_RATE,
    );
    const newCount = existing.reinforcementCount + 1;

    db.prepare(`
      UPDATE insights 
      SET reinforcement_count = reinforcement_count + 1,
          confidence = ?,
          last_retrieved_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newConfidence, id);

    // Record history
    this.history.recordReinforce(id, oldConfidence, newConfidence, newCount);

    return this.get(id)!;
  }

  /**
   * Find insights with similar claims using word-level Jaccard similarity.
   * Returns results sorted by similarity descending.
   */
  findSimilar(claim: string, minSimilarity = 0.2, excludeId?: string): SimilarResult[] {
    const queryWords = this.tokenize(claim);
    if (queryWords.size === 0) return [];

    const allInsights = this.list();
    const results: SimilarResult[] = [];

    for (const insight of allInsights) {
      if (excludeId && insight.id === excludeId) continue;

      const insightWords = this.tokenize(insight.claim);
      const similarity = this.jaccardSimilarity(queryWords, insightWords);

      if (similarity >= minSimilarity) {
        results.push({ insight, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results;
  }

  /**
   * Merge source insight into target. Target survives with combined data:
   * - confidence: max of both
   * - tags: union (deduplicated)
   * - reinforcementCount: sum of both
   * - reasoning: concatenated if both exist
   * - claim: target's claim unless overridden
   * 
   * Source is deleted after merge.
   */
  merge(sourceId: string, targetId: string, options: MergeOptions = {}): Insight {
    if (sourceId === targetId) {
      throw new Error('Cannot merge an insight with itself');
    }

    const source = this.get(sourceId);
    if (!source) {
      throw new Error(`Source insight not found: ${sourceId}`);
    }

    const target = this.get(targetId);
    if (!target) {
      throw new Error(`Target insight not found: ${targetId}`);
    }

    // Combine fields
    const mergedConfidence = Math.max(source.confidence, target.confidence);
    const mergedTags = [...new Set([...target.tags, ...source.tags])];
    const mergedReinforcement = target.reinforcementCount + source.reinforcementCount;

    let mergedReasoning = target.reasoning;
    if (source.reasoning) {
      mergedReasoning = mergedReasoning
        ? `${mergedReasoning}; ${source.reasoning}`
        : source.reasoning;
    }

    const mergedClaim = options.claim ?? target.claim;

    // Update target
    const db = getDatabase();
    db.prepare(`
      UPDATE insights
      SET claim = ?,
          confidence = ?,
          tags = ?,
          reinforcement_count = ?,
          reasoning = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      mergedClaim,
      mergedConfidence,
      JSON.stringify(mergedTags),
      mergedReinforcement,
      mergedReasoning ?? null,
      targetId,
    );

    // Record history for changed fields
    const mergeChanges: Record<string, { old: string; new: string }> = {};
    if (mergedClaim !== target.claim) mergeChanges.claim = { old: target.claim, new: mergedClaim };
    if (mergedConfidence !== target.confidence) mergeChanges.confidence = { old: String(target.confidence), new: String(mergedConfidence) };
    if (JSON.stringify(mergedTags) !== JSON.stringify(target.tags)) mergeChanges.tags = { old: JSON.stringify(target.tags), new: JSON.stringify(mergedTags) };
    if (mergedReinforcement !== target.reinforcementCount) mergeChanges.reinforcement_count = { old: String(target.reinforcementCount), new: String(mergedReinforcement) };
    if (mergedReasoning !== target.reasoning) mergeChanges.reasoning = { old: target.reasoning ?? '', new: mergedReasoning ?? '' };

    if (Object.keys(mergeChanges).length > 0) {
      this.history.recordMerge(targetId, sourceId, mergeChanges);
    }

    // Delete source
    this.archive(sourceId);

    return this.get(targetId)!;
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2)  // skip tiny words like "a", "on", "is"
    );
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;

    let intersection = 0;
    for (const word of a) {
      if (b.has(word)) intersection++;
    }

    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
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
