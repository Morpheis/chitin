import { describe, it, expect } from 'vitest';
import { scoreInsight, generateQualityReport } from '../src/pro/quality.js';
import type { Insight } from '../src/types.js';

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'test-123',
    type: 'behavioral',
    claim: 'Test insight claim',
    confidence: 0.85,
    tags: ['test'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    reinforcementCount: 0,
    avoid: false,
    ...overrides,
  };
}

const NOW = new Date('2026-03-28T09:00:00Z');

describe('scoreInsight', () => {
  it('scores a brand new insight', () => {
    const insight = makeInsight({
      createdAt: '2026-03-28T08:00:00.000Z',
      updatedAt: '2026-03-28T08:00:00.000Z',
    });
    const score = scoreInsight(insight, NOW);
    expect(score.quality).toBeGreaterThan(0);
    expect(score.quality).toBeLessThan(1);
    expect(score.status).toBe('fading'); // new, never recalled
  });

  it('scores a thriving insight with reinforcements and recent recall', () => {
    const insight = makeInsight({
      reinforcementCount: 5,
      confidence: 0.95,
      lastRetrievedAt: '2026-03-27T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const score = scoreInsight(insight, NOW);
    expect(score.quality).toBeGreaterThan(0.6);
    expect(score.status).toBe('thriving');
  });

  it('detects dormant insights', () => {
    const insight = makeInsight({
      reinforcementCount: 0,
      confidence: 0.5,
      lastRetrievedAt: '2025-12-01T00:00:00.000Z', // 118 days ago
      createdAt: '2025-11-01T00:00:00.000Z',
    });
    const score = scoreInsight(insight, NOW);
    expect(score.status).toBe('dormant');
    expect(score.recommendation).toContain('archiving');
  });

  it('detects stale insights', () => {
    const insight = makeInsight({
      reinforcementCount: 1,
      confidence: 0.7,
      lastRetrievedAt: '2026-02-15T00:00:00.000Z', // 41 days ago
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const score = scoreInsight(insight, NOW);
    expect(score.status).toBe('stale');
  });

  it('handles never-recalled insights', () => {
    const insight = makeInsight({
      lastRetrievedAt: undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const score = scoreInsight(insight, NOW);
    expect(score.daysSinceLastRecall).toBeNull();
  });

  it('rewards engagement over time', () => {
    const low = makeInsight({ reinforcementCount: 0 });
    const high = makeInsight({ reinforcementCount: 10 });
    
    const lowScore = scoreInsight(low, NOW);
    const highScore = scoreInsight(high, NOW);
    
    expect(highScore.components.engagement).toBeGreaterThan(lowScore.components.engagement);
  });
});

describe('generateQualityReport', () => {
  it('generates a report for empty insights', () => {
    const report = generateQualityReport([], NOW);
    expect(report.totalInsights).toBe(0);
    expect(report.averageQuality).toBe(0);
  });

  it('generates a report with distribution', () => {
    const insights = [
      makeInsight({ id: '1', reinforcementCount: 5, lastRetrievedAt: '2026-03-27T00:00:00Z', confidence: 0.95 }),
      makeInsight({ id: '2', reinforcementCount: 0, lastRetrievedAt: undefined, confidence: 0.5 }),
      makeInsight({ id: '3', reinforcementCount: 0, lastRetrievedAt: '2025-12-01T00:00:00Z', confidence: 0.5 }),
    ];
    
    const report = generateQualityReport(insights, NOW);
    expect(report.totalInsights).toBe(3);
    expect(report.averageQuality).toBeGreaterThan(0);
    expect(report.topInsights.length).toBeLessThanOrEqual(10);
  });

  it('identifies stale insights in report', () => {
    const insights = Array.from({ length: 10 }, (_, i) =>
      makeInsight({
        id: `stale-${i}`,
        reinforcementCount: 0,
        lastRetrievedAt: '2025-10-01T00:00:00Z',
        confidence: 0.5,
      })
    );
    
    const report = generateQualityReport(insights, NOW);
    expect(report.staleInsights.length).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});
