import type { InsightType } from '../types.js';
import type { ScoredInsight } from './retrieve.js';

export interface MarshalOptions {
  tokenBudget?: number;      // max tokens for output (default 2000)
  includeContext?: boolean;   // include context field when space allows
  format?: 'compact' | 'full'; // compact omits reasoning/limitations
}

const TYPE_LABELS: Record<InsightType, string> = {
  behavioral: 'Behavioral',
  personality: 'Personality',
  relational: 'Relational',
  principle: 'Principle',
  skill: 'Skill',
  trigger: 'Trigger',
};

// Type display order — personality/relational first (identity), then behavioral, principles, skills, triggers last
const TYPE_ORDER: InsightType[] = ['personality', 'relational', 'behavioral', 'principle', 'skill', 'trigger'];

/**
 * Rough token estimation. ~1 token per 4 characters for English text.
 * Not exact, but sufficient for budgeting.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Marshal scored insights into a compact, token-efficient context block
 * suitable for injection into a system prompt.
 * 
 * Groups insights by type, uses bullet-point format, respects token budget.
 */
export function marshal(scored: ScoredInsight[], options: MarshalOptions = {}): string {
  const {
    tokenBudget = 2000,
    includeContext = false,
    format = 'compact',
  } = options;

  if (scored.length === 0) return '';

  // Group by type
  const groups = new Map<InsightType, ScoredInsight[]>();
  for (const s of scored) {
    const existing = groups.get(s.insight.type) ?? [];
    existing.push(s);
    groups.set(s.insight.type, existing);
  }

  const lines: string[] = [];
  let currentTokens = 0;
  const headerBudget = estimateTokens('## Personality Context\n\n');
  currentTokens += headerBudget;

  // Build sections in display order
  for (const type of TYPE_ORDER) {
    const insights = groups.get(type);
    if (!insights || insights.length === 0) continue;

    const sectionHeader = `### ${TYPE_LABELS[type]}`;
    const headerTokens = estimateTokens(sectionHeader + '\n');

    if (currentTokens + headerTokens > tokenBudget) break;

    lines.push(sectionHeader);
    currentTokens += headerTokens;

    for (const s of insights) {
      let line: string;

      // Special formatting for triggers: "When X → do/avoid Y"
      if (s.insight.type === 'trigger' && s.insight.condition) {
        const action = s.insight.avoid ? 'avoid' : 'do';
        line = `- When: ${s.insight.condition} → ${action}: ${s.insight.claim}`;
      } else {
        line = `- ${s.insight.claim}`;
      }

      if (includeContext && s.insight.context && format === 'compact') {
        line += ` (${s.insight.context})`;
      }

      if (format === 'full') {
        if (s.insight.context) line += `\n  Context: ${s.insight.context}`;
        if (s.insight.reasoning) line += `\n  Reasoning: ${s.insight.reasoning}`;
        if (s.insight.limitations) line += `\n  Limitations: ${s.insight.limitations}`;
      }

      const lineTokens = estimateTokens(line + '\n');

      if (currentTokens + lineTokens > tokenBudget) break;

      lines.push(line);
      currentTokens += lineTokens;
    }

    lines.push(''); // blank line between sections
  }

  return lines.join('\n').trim();
}
