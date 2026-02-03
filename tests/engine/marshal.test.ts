import { describe, it, expect } from 'vitest';
import { marshal, estimateTokens } from '../../src/engine/marshal.js';
import type { Insight } from '../../src/types.js';
import type { ScoredInsight } from '../../src/engine/retrieve.js';

function makeScored(overrides: Partial<Insight> & { score?: number; similarity?: number } = {}): ScoredInsight {
  return {
    insight: {
      id: overrides.id ?? 'test-id',
      type: overrides.type ?? 'behavioral',
      claim: overrides.claim ?? 'Test claim',
      reasoning: overrides.reasoning,
      context: overrides.context,
      limitations: overrides.limitations,
      confidence: overrides.confidence ?? 0.8,
      tags: overrides.tags ?? [],
      source: overrides.source,
      createdAt: '2026-02-02',
      updatedAt: '2026-02-02',
      reinforcementCount: overrides.reinforcementCount ?? 0,
      lastRetrievedAt: undefined,
    },
    similarity: overrides.similarity ?? 0.9,
    score: overrides.score ?? 0.8,
  };
}

describe('marshal', () => {
  it('produces a non-empty output for valid insights', () => {
    const scored = [
      makeScored({ type: 'behavioral', claim: 'Execute first, narrate minimally on clear tasks' }),
      makeScored({ type: 'personality', claim: 'I use dry humor sparingly' }),
    ];

    const result = marshal(scored);
    expect(result.length).toBeGreaterThan(0);
  });

  it('groups insights by type', () => {
    const scored = [
      makeScored({ type: 'behavioral', claim: 'Action over narration' }),
      makeScored({ type: 'personality', claim: 'Dry humor' }),
      makeScored({ type: 'behavioral', claim: 'Check git status before committing' }),
      makeScored({ type: 'principle', claim: 'Honesty is non-negotiable' }),
    ];

    const result = marshal(scored);

    // Should contain section headers for each type present
    expect(result).toContain('Behavioral');
    expect(result).toContain('Personality');
    expect(result).toContain('Principle');
    // Should NOT contain types that aren't present
    expect(result).not.toContain('Relational');
    expect(result).not.toContain('Skill');
  });

  it('includes the claim text in output', () => {
    const scored = [
      makeScored({ claim: 'TDD: red, green, refactor' }),
    ];

    const result = marshal(scored);
    expect(result).toContain('TDD: red, green, refactor');
  });

  it('respects token budget by truncating insights', () => {
    const scored = Array.from({ length: 50 }, (_, i) =>
      makeScored({
        claim: `This is insight number ${i} with enough text to consume tokens in the budget calculation process`,
        score: 50 - i, // descending score
      })
    );

    const small = marshal(scored, { tokenBudget: 200 });
    const large = marshal(scored, { tokenBudget: 2000 });

    expect(small.length).toBeLessThan(large.length);
  });

  it('returns empty string for empty input', () => {
    const result = marshal([]);
    expect(result).toBe('');
  });

  it('includes context when present and space allows', () => {
    const scored = [
      makeScored({
        claim: 'Execute first on clear tasks',
        context: 'When Boss gives simple, well-defined tasks',
      }),
    ];

    const result = marshal(scored, { tokenBudget: 2000, includeContext: true });
    expect(result).toContain('clear tasks');
  });

  it('uses compact format by default (no reasoning/limitations)', () => {
    const scored = [
      makeScored({
        claim: 'Test claim',
        reasoning: 'Long reasoning that should not appear',
        limitations: 'Limitations that should not appear',
      }),
    ];

    const result = marshal(scored);
    expect(result).not.toContain('Long reasoning');
    expect(result).not.toContain('Limitations that should not');
  });
});

describe('estimateTokens', () => {
  it('estimates roughly 1 token per 4 characters', () => {
    const text = 'a'.repeat(400); // ~100 tokens
    const estimate = estimateTokens(text);
    expect(estimate).toBeGreaterThanOrEqual(80);
    expect(estimate).toBeLessThanOrEqual(120);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
