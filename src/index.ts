#!/usr/bin/env node

import { Command } from 'commander';
import { initDatabase, closeDatabase } from './db/schema.js';
import { InsightRepository } from './db/repository.js';
import { EmbeddingStore } from './db/embeddings.js';
import { RetrievalEngine } from './engine/retrieve.js';
import { marshal, estimateTokens } from './engine/marshal.js';
import { detectContext } from './engine/context-detect.js';
import type { InsightType, INSIGHT_TYPES } from './types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DEFAULT_DB_DIR = path.join(os.homedir(), '.config', 'chitin');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'insights.db');

function ensureDbDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDb(dbPath: string): { repo: InsightRepository; embeddings: EmbeddingStore } {
  ensureDbDir(dbPath);
  initDatabase(dbPath);
  return {
    repo: new InsightRepository(),
    embeddings: new EmbeddingStore(),
  };
}

const program = new Command();

program
  .name('chitin')
  .description('Personality persistence layer for AI agents. Structured insights about how you think, not what you remember.')
  .version('0.1.0')
  .option('--db <path>', 'Database path', DEFAULT_DB_PATH);

// === contribute ===
program
  .command('contribute')
  .description('Add a new insight')
  .requiredOption('--type <type>', 'Insight type: behavioral | personality | relational | principle | skill')
  .requiredOption('--claim <text>', 'The core insight')
  .option('--reasoning <text>', 'How you arrived at this')
  .option('--context <text>', 'When this applies')
  .option('--limitations <text>', 'When this breaks down')
  .requiredOption('--confidence <number>', 'Confidence level 0.0-1.0')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--source <text>', 'What experience led to this')
  .option('--json', 'Input from JSON stdin')
  .option('--force', 'Skip conflict detection')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const input = opts.json
        ? JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8'))
        : {
            type: opts.type as InsightType,
            claim: opts.claim,
            reasoning: opts.reasoning,
            context: opts.context,
            limitations: opts.limitations,
            confidence: parseFloat(opts.confidence),
            tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
            source: opts.source,
          };

      const result = repo.contributeWithCheck(input, { force: !!opts.force });

      if (opts.format === 'json') {
        console.log(JSON.stringify({
          insight: result.insight,
          conflicts: result.conflicts.map(c => ({
            id: c.insight.id,
            type: c.insight.type,
            claim: c.insight.claim,
            similarity: c.similarity,
            tensionScore: c.tensionScore,
            tensionReason: c.tensionReason,
            conflictScore: c.conflictScore,
          })),
        }, null, 2));
      } else {
        console.log(`✓ Contributed ${result.insight.type} insight: ${result.insight.id}`);
        console.log(`  "${result.insight.claim}"`);
        console.log(`  confidence: ${result.insight.confidence} | tags: ${result.insight.tags.join(', ') || '(none)'}`);

        if (result.conflicts.length > 0) {
          console.log('');
          console.log(`⚠ ${result.conflicts.length} potential conflict(s) detected:`);
          for (const c of result.conflicts) {
            const pct = (c.conflictScore * 100).toFixed(0);
            console.log('');
            console.log(`  [${c.insight.type}] "${c.insight.claim}"`);
            console.log(`    conflict: ${pct}% | tension: ${c.tensionReason}`);
            console.log(`    id: ${c.insight.id}`);
          }
          console.log('');
          console.log('  Consider: chitin merge, chitin update, or chitin archive to resolve.');
        }
      }
    } finally {
      closeDatabase();
    }
  });

// === get ===
program
  .command('get <id>')
  .description('Get a specific insight by ID')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((id, opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const insight = repo.get(id);
      if (!insight) {
        console.error(`Insight not found: ${id}`);
        process.exit(1);
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(insight, null, 2));
      } else {
        console.log(`[${insight.type}] ${insight.claim}`);
        if (insight.reasoning) console.log(`  Reasoning: ${insight.reasoning}`);
        if (insight.context) console.log(`  Context: ${insight.context}`);
        if (insight.limitations) console.log(`  Limitations: ${insight.limitations}`);
        console.log(`  Confidence: ${insight.confidence} | Reinforced: ${insight.reinforcementCount}x`);
        console.log(`  Tags: ${insight.tags.join(', ') || '(none)'}`);
        console.log(`  ID: ${insight.id}`);
      }
    } finally {
      closeDatabase();
    }
  });

// === update ===
program
  .command('update <id>')
  .description('Update an existing insight')
  .option('--claim <text>', 'Updated claim')
  .option('--reasoning <text>', 'Updated reasoning')
  .option('--context <text>', 'Updated context')
  .option('--limitations <text>', 'Updated limitations')
  .option('--confidence <number>', 'Updated confidence')
  .option('--tags <tags>', 'Updated comma-separated tags')
  .option('--source <text>', 'Updated source')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((id, opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const updates: Record<string, unknown> = {};
      if (opts.claim) updates.claim = opts.claim;
      if (opts.reasoning) updates.reasoning = opts.reasoning;
      if (opts.context) updates.context = opts.context;
      if (opts.limitations) updates.limitations = opts.limitations;
      if (opts.confidence) updates.confidence = parseFloat(opts.confidence);
      if (opts.tags) updates.tags = opts.tags.split(',').map((t: string) => t.trim());
      if (opts.source) updates.source = opts.source;

      const insight = repo.update(id, updates);

      if (opts.format === 'json') {
        console.log(JSON.stringify(insight, null, 2));
      } else {
        console.log(`✓ Updated insight: ${insight.id}`);
        console.log(`  "${insight.claim}"`);
      }
    } finally {
      closeDatabase();
    }
  });

// === reinforce ===
program
  .command('reinforce <id>')
  .description('Bump reinforcement count for an insight')
  .action((id) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const insight = repo.reinforce(id);
      console.log(`✓ Reinforced: ${insight.claim}`);
      console.log(`  Count: ${insight.reinforcementCount}`);
    } finally {
      closeDatabase();
    }
  });

// === archive ===
program
  .command('archive <id>')
  .description('Remove an insight (soft delete)')
  .action((id) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      repo.archive(id);
      console.log(`✓ Archived insight: ${id}`);
    } finally {
      closeDatabase();
    }
  });

// === list ===
program
  .command('list')
  .description('List insights with optional filters')
  .option('--type <types>', 'Filter by type (comma-separated)')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('--min-confidence <number>', 'Minimum confidence threshold')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const options: Record<string, unknown> = {};
      if (opts.type) options.types = opts.type.split(',').map((t: string) => t.trim());
      if (opts.tags) options.tags = opts.tags.split(',').map((t: string) => t.trim());
      if (opts.minConfidence) options.minConfidence = parseFloat(opts.minConfidence);

      const insights = repo.list(options as any);

      if (opts.format === 'json') {
        console.log(JSON.stringify(insights, null, 2));
      } else {
        if (insights.length === 0) {
          console.log('No insights found.');
          return;
        }
        for (const i of insights) {
          const tags = i.tags.length > 0 ? ` [${i.tags.join(', ')}]` : '';
          const reinforced = i.reinforcementCount > 0 ? ` (${i.reinforcementCount}×)` : '';
          console.log(`  [${i.type}] ${i.claim}${tags}${reinforced}`);
          console.log(`    confidence: ${i.confidence} | id: ${i.id}`);
        }
        console.log(`\n${insights.length} insight(s)`);
      }
    } finally {
      closeDatabase();
    }
  });

// === stats ===
program
  .command('stats')
  .description('Show insight statistics')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const stats = repo.stats();

      if (opts.format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('Chitin Insights');
        console.log(`  Total: ${stats.total}`);
        console.log(`  Average confidence: ${stats.averageConfidence.toFixed(2)}`);
        console.log('  By type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          if (count > 0) console.log(`    ${type}: ${count}`);
        }
      }
    } finally {
      closeDatabase();
    }
  });

// === reflect ===
program
  .command('reflect')
  .description('Review pending session reflections and current insight state')
  .option('--pending-path <path>', 'Path to pending-reflection.json', path.join(DEFAULT_DB_DIR, 'pending-reflection.json'))
  .option('--clear', 'Clear pending reflections after display')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      // Read pending reflections
      let pending: Array<{ sessionKey: string; timestamp: string; reason: string }> = [];
      try {
        if (fs.existsSync(opts.pendingPath)) {
          pending = JSON.parse(fs.readFileSync(opts.pendingPath, 'utf-8'));
        }
      } catch {
        pending = [];
      }

      const stats = repo.stats();

      if (opts.format === 'json') {
        console.log(JSON.stringify({ pending, stats }, null, 2));
        if (opts.clear && pending.length > 0) {
          fs.writeFileSync(opts.pendingPath, '[]');
        }
        return;
      }

      // Human format
      if (pending.length === 0) {
        console.log('No pending reflections.');
      } else {
        console.log(`${pending.length} pending reflection(s):\n`);
        for (const entry of pending) {
          const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'unknown';
          console.log(`  • ${entry.sessionKey} (${entry.reason}) — ${time}`);
        }
      }

      console.log(`\nCurrent state: ${stats.total} insight(s), avg confidence ${stats.averageConfidence.toFixed(2)}`);

      if (opts.clear && pending.length > 0) {
        fs.writeFileSync(opts.pendingPath, '[]');
        console.log('\n✓ Cleared pending reflections.');
      }
    } finally {
      closeDatabase();
    }
  });

// === similar ===
program
  .command('similar <claim>')
  .description('Find insights similar to a given claim')
  .option('--threshold <number>', 'Minimum similarity (0-1)', '0.2')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((claim, opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const threshold = parseFloat(opts.threshold);
      const results = repo.findSimilar(claim, threshold);

      if (opts.format === 'json') {
        console.log(JSON.stringify(results.map(r => ({
          id: r.insight.id,
          type: r.insight.type,
          claim: r.insight.claim,
          similarity: r.similarity,
        })), null, 2));
        return;
      }

      if (results.length === 0) {
        console.log('No similar insights found.');
        return;
      }

      console.log(`Found ${results.length} similar insight(s):\n`);
      for (const r of results) {
        const pct = (r.similarity * 100).toFixed(0);
        console.log(`  [${pct}%] [${r.insight.type}] ${r.insight.claim}`);
        console.log(`    id: ${r.insight.id}`);
      }
    } finally {
      closeDatabase();
    }
  });

// === merge ===
program
  .command('merge <sourceId> <targetId>')
  .description('Merge source insight into target (source is deleted)')
  .option('--claim <text>', 'Override the merged claim')
  .option('--format <fmt>', 'Output format: json | human', 'human')
  .action((sourceId, targetId, opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const mergeOpts: { claim?: string } = {};
      if (opts.claim) mergeOpts.claim = opts.claim;

      const merged = repo.merge(sourceId, targetId, mergeOpts);

      if (opts.format === 'json') {
        console.log(JSON.stringify(merged, null, 2));
      } else {
        console.log(`✓ Merged into: ${merged.id}`);
        console.log(`  "${merged.claim}"`);
        console.log(`  confidence: ${merged.confidence} | reinforced: ${merged.reinforcementCount}×`);
        console.log(`  tags: ${merged.tags.join(', ') || '(none)'}`);
      }
    } finally {
      closeDatabase();
    }
  });

// === retrieve ===
program
  .command('retrieve')
  .description('Get relevant personality context for a query')
  .requiredOption('--query <text>', 'The incoming context/message')
  .option('--budget <number>', 'Token budget for output', '2000')
  .option('--max-results <number>', 'Maximum insights to consider', '15')
  .option('--format <fmt>', 'Output format: compact | json | full', 'compact')
  .action((opts) => {
    const dbPath = program.opts().db;
    const { repo, embeddings } = getDb(dbPath);

    try {
      const engine = new RetrievalEngine(repo, embeddings);
      const context = detectContext(opts.query);

      // For now, without real embeddings, fall back to listing by type boost
      // TODO: integrate real embedding generation
      const allInsights = repo.list();
      
      if (allInsights.length === 0) {
        if (opts.format === 'json') {
          console.log(JSON.stringify({ insights: [], context: '', tokenEstimate: 0 }));
        } else {
          console.log('No insights stored yet. Use `chitin contribute` to add some.');
        }
        return;
      }

      // Check if we have embeddings
      const missing = embeddings.findMissingEmbeddings();
      const hasEmbeddings = missing.length < allInsights.length;

      let scoredInsights;
      if (hasEmbeddings) {
        // Use semantic retrieval (need query embedding — placeholder for now)
        // TODO: generate real embedding for query
        console.error('Note: Real embedding generation not yet wired. Using type-boosted fallback.');
      }
      
      // Fallback: score all insights using type boosts and confidence
      scoredInsights = allInsights.map(insight => {
        const typeBoost = context.typeBoosts[insight.type] ?? 1.0;
        const reinforcementFactor = Math.log2(insight.reinforcementCount + 2);
        const score = insight.confidence * reinforcementFactor * typeBoost;
        return { insight, similarity: 1.0, score };
      });

      scoredInsights.sort((a, b) => b.score - a.score);
      scoredInsights = scoredInsights.slice(0, parseInt(opts.maxResults));

      const budget = parseInt(opts.budget);

      if (opts.format === 'json') {
        const output = marshal(scoredInsights, { tokenBudget: budget });
        console.log(JSON.stringify({
          category: context.category,
          insights: scoredInsights.map(s => ({
            id: s.insight.id,
            type: s.insight.type,
            claim: s.insight.claim,
            score: s.score,
          })),
          context: output,
          tokenEstimate: estimateTokens(output),
        }, null, 2));
      } else if (opts.format === 'full') {
        const output = marshal(scoredInsights, { tokenBudget: budget, format: 'full', includeContext: true });
        console.log(output);
      } else {
        const output = marshal(scoredInsights, { tokenBudget: budget });
        console.log(output);
      }
    } finally {
      closeDatabase();
    }
  });

// === export ===
program
  .command('export')
  .description('Export all insights as JSON')
  .action(() => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const insights = repo.list();
      console.log(JSON.stringify(insights, null, 2));
    } finally {
      closeDatabase();
    }
  });

// === import ===
program
  .command('import <file>')
  .description('Import insights from a JSON file')
  .option('--merge', 'Merge with existing (skip duplicates by claim)')
  .action((file, opts) => {
    const dbPath = program.opts().db;
    const { repo } = getDb(dbPath);

    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const insights = Array.isArray(data) ? data : [data];
      
      let imported = 0;
      let skipped = 0;

      const existing = opts.merge ? new Set(repo.list().map(i => i.claim)) : new Set();

      for (const item of insights) {
        if (opts.merge && existing.has(item.claim)) {
          skipped++;
          continue;
        }
        repo.contribute({
          type: item.type,
          claim: item.claim,
          reasoning: item.reasoning,
          context: item.context,
          limitations: item.limitations,
          confidence: item.confidence ?? 0.5,
          tags: item.tags ?? [],
          source: item.source,
        });
        imported++;
      }

      console.log(`✓ Imported ${imported} insight(s)${skipped > 0 ? `, skipped ${skipped} duplicate(s)` : ''}`);
    } finally {
      closeDatabase();
    }
  });

// === init ===
program
  .command('init')
  .description('Initialize the database')
  .action(() => {
    const dbPath = program.opts().db;
    ensureDbDir(dbPath);
    initDatabase(dbPath);
    console.log(`✓ Database initialized at ${dbPath}`);
    closeDatabase();
  });

program.parse();
