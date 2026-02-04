import { describe, it, expect } from 'vitest';
import {
  mapInsightToContribution,
  mapContributionToInsight,
  isPromotable,
  type PromotabilityResult,
} from '../../src/carapace/mapper.js';
import type { Insight } from '../../src/types.js';

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'test-id-1234',
    type: 'skill',
    claim: 'Test claim about coding patterns',
    reasoning: 'Discovered through trial and error',
    context: 'When working on TypeScript projects',
    limitations: 'Does not apply to Python',
    confidence: 0.85,
    tags: ['typescript', 'patterns'],
    source: undefined,
    createdAt: '2026-02-01 10:00:00',
    updatedAt: '2026-02-01 10:00:00',
    reinforcementCount: 2,
    ...overrides,
  };
}

describe('mapInsightToContribution', () => {
  it('maps basic fields correctly', () => {
    const insight = makeInsight();
    const result = mapInsightToContribution(insight);

    expect(result.claim).toBe('Test claim about coding patterns');
    expect(result.confidence).toBe(0.85);
    expect(result.reasoning).toBe('Discovered through trial and error');
    expect(result.limitations).toBe('Does not apply to Python');
  });

  it('maps context to applicability', () => {
    const insight = makeInsight({ context: 'When building CLI tools' });
    const result = mapInsightToContribution(insight);

    expect(result.applicability).toBe('When building CLI tools');
  });

  it('maps tags to domainTags', () => {
    const insight = makeInsight({ tags: ['memory', 'architecture'] });
    const result = mapInsightToContribution(insight);

    expect(result.domainTags).toEqual(['memory', 'architecture']);
  });

  it('allows overriding domainTags', () => {
    const insight = makeInsight({ tags: ['memory'] });
    const result = mapInsightToContribution(insight, { domainTags: ['agent-memory', 'patterns'] });

    expect(result.domainTags).toEqual(['agent-memory', 'patterns']);
  });

  it('handles missing optional fields', () => {
    const insight = makeInsight({
      reasoning: undefined,
      context: undefined,
      limitations: undefined,
    });
    const result = mapInsightToContribution(insight);

    expect(result.reasoning).toBeUndefined();
    expect(result.applicability).toBeUndefined();
    expect(result.limitations).toBeUndefined();
  });
});

describe('mapContributionToInsight', () => {
  const contribution = {
    id: 'carapace-uuid-1234',
    claim: 'Agents should use structured memory',
    reasoning: 'Based on experience with context windows',
    applicability: 'Persistent agents with session boundaries',
    limitations: 'Not needed for single-task agents',
    confidence: 0.9,
    domainTags: ['agent-memory', 'architecture'],
    contributor: { id: 'agent-123', displayName: 'TestAgent', trustScore: 0.8 },
  };

  it('maps basic fields correctly', () => {
    const result = mapContributionToInsight(contribution);

    expect(result.claim).toBe('Agents should use structured memory');
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBe('Based on experience with context windows');
    expect(result.limitations).toBe('Not needed for single-task agents');
  });

  it('maps applicability to context', () => {
    const result = mapContributionToInsight(contribution);
    expect(result.context).toBe('Persistent agents with session boundaries');
  });

  it('maps domainTags to tags', () => {
    const result = mapContributionToInsight(contribution);
    expect(result.tags).toEqual(['agent-memory', 'architecture']);
  });

  it('defaults type to skill', () => {
    const result = mapContributionToInsight(contribution);
    expect(result.type).toBe('skill');
  });

  it('allows overriding type', () => {
    const result = mapContributionToInsight(contribution, { type: 'principle' });
    expect(result.type).toBe('principle');
  });

  it('sets source to carapace:<id>', () => {
    const result = mapContributionToInsight(contribution);
    expect(result.source).toBe('carapace:carapace-uuid-1234');
  });

  it('handles missing optional fields', () => {
    const minimal = {
      id: 'min-id',
      claim: 'Minimal claim',
      confidence: 0.5,
      domainTags: [],
      contributor: { id: 'a', displayName: 'A', trustScore: 0.5 },
    };
    const result = mapContributionToInsight(minimal);

    expect(result.reasoning).toBeUndefined();
    expect(result.context).toBeUndefined();
    expect(result.limitations).toBeUndefined();
    expect(result.tags).toEqual([]);
  });
});

describe('isPromotable', () => {
  it('returns promotable for high-confidence universal skill', () => {
    const insight = makeInsight({ type: 'skill', confidence: 0.85, reinforcementCount: 2 });
    const result = isPromotable(insight);

    expect(result.promotable).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('rejects relational insights', () => {
    const insight = makeInsight({ type: 'relational' });
    const result = isPromotable(insight);

    expect(result.promotable).toBe(false);
    expect(result.reasons).toContain('Relational insights are personal and should not be shared publicly');
  });

  it('warns on low confidence', () => {
    const insight = makeInsight({ confidence: 0.4 });
    const result = isPromotable(insight);

    expect(result.promotable).toBe(false);
    expect(result.reasons.some(r => r.includes('confidence'))).toBe(true);
  });

  it('warns on never-reinforced insights', () => {
    const insight = makeInsight({ reinforcementCount: 0 });
    const result = isPromotable(insight);

    expect(result.promotable).toBe(false);
    expect(result.reasons.some(r => r.includes('reinforced'))).toBe(true);
  });

  it('warns on boss-specific tags', () => {
    const insight = makeInsight({ type: 'behavioral', tags: ['boss', 'communication'] });
    const result = isPromotable(insight);

    expect(result.promotable).toBe(false);
    expect(result.reasons.some(r => r.includes('personal'))).toBe(true);
  });

  it('allows force override', () => {
    const insight = makeInsight({ type: 'relational' });
    const result = isPromotable(insight, { force: true });

    expect(result.promotable).toBe(true);
    // Should still have warnings
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('accepts personality insights that are universal', () => {
    const insight = makeInsight({
      type: 'personality',
      confidence: 0.85,
      reinforcementCount: 1,
      tags: ['identity', 'philosophy'],
    });
    const result = isPromotable(insight);

    expect(result.promotable).toBe(true);
  });

  it('accepts principle insights', () => {
    const insight = makeInsight({
      type: 'principle',
      confidence: 0.9,
      reinforcementCount: 3,
      tags: ['security', 'ethics'],
    });
    const result = isPromotable(insight);

    expect(result.promotable).toBe(true);
  });
});
