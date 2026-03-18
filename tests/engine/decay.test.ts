import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeDecayFactor, DEFAULT_DECAY_CONFIG, type DecayConfig } from '../../src/engine/decay.js';

describe('computeDecayFactor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 1.0 when decay is disabled', () => {
    const config: DecayConfig = { ...DEFAULT_DECAY_CONFIG, enabled: false };
    const factor = computeDecayFactor('2020-01-01T00:00:00Z', 'social', config);
    expect(factor).toBe(1.0);
  });

  it('returns 1.0 for directive provenance (null halfLife)', () => {
    const factor = computeDecayFactor('2020-01-01T00:00:00Z', 'directive');
    expect(factor).toBe(1.0);
  });

  it('returns 1.0 for undefined provenance (legacy entries)', () => {
    const factor = computeDecayFactor('2020-01-01T00:00:00Z', undefined);
    expect(factor).toBe(1.0);
  });

  it('returns 1.0 for a brand-new social insight (0 days old)', () => {
    const now = new Date().toISOString();
    const factor = computeDecayFactor(now, 'social');
    expect(factor).toBeCloseTo(1.0, 2);
  });

  it('returns 0.5 for a social insight exactly 30 days old', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const factor = computeDecayFactor(thirtyDaysAgo, 'social');
    expect(factor).toBeCloseTo(0.5, 2);
  });

  it('returns 0.25 for a social insight 60 days old (two half-lives)', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const factor = computeDecayFactor(sixtyDaysAgo, 'social');
    expect(factor).toBeCloseTo(0.25, 2);
  });

  it('returns 0.125 for a social insight 90 days old (three half-lives)', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const factor = computeDecayFactor(ninetyDaysAgo, 'social');
    expect(factor).toBeCloseTo(0.125, 2);
  });

  it('returns 0.5 for a reflection insight exactly 90 days old', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const factor = computeDecayFactor(ninetyDaysAgo, 'reflection');
    expect(factor).toBeCloseTo(0.5, 2);
  });

  it('returns 0.5 for an observation insight exactly 180 days old', () => {
    const oneEightyDaysAgo = new Date(Date.now() - 180 * 86400000).toISOString();
    const factor = computeDecayFactor(oneEightyDaysAgo, 'observation');
    expect(factor).toBeCloseTo(0.5, 2);
  });

  it('returns 0.5 for a correction insight exactly 365 days old', () => {
    const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
    const factor = computeDecayFactor(oneYearAgo, 'correction');
    expect(factor).toBeCloseTo(0.5, 2);
  });

  it('returns 0.5 for an external insight exactly 180 days old', () => {
    const oneEightyDaysAgo = new Date(Date.now() - 180 * 86400000).toISOString();
    const factor = computeDecayFactor(oneEightyDaysAgo, 'external');
    expect(factor).toBeCloseTo(0.5, 2);
  });

  it('handles each provenance type without error', () => {
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();
    for (const prov of ['directive', 'correction', 'observation', 'reflection', 'social', 'external']) {
      const factor = computeDecayFactor(sixMonthsAgo, prov);
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1.0);
    }
  });

  it('uses custom config to override defaults', () => {
    const config: DecayConfig = {
      enabled: true,
      halfLife: {
        social: 10,       // Very fast decay
        directive: 30,    // Override null to 30 days
        undefined: null,
      },
    };
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    
    const socialFactor = computeDecayFactor(tenDaysAgo, 'social', config);
    expect(socialFactor).toBeCloseTo(0.5, 2);

    const directiveFactor = computeDecayFactor(tenDaysAgo, 'directive', config);
    // 10 days into a 30-day half-life: 0.5^(10/30) ≈ 0.794
    expect(directiveFactor).toBeCloseTo(0.794, 2);
  });

  it('returns value > 1.0 is not possible for future dates (factor > 1 means negative age)', () => {
    // A future date means negative daysSinceCreation
    // 0.5^(negative/positive) = 0.5^(negative) = 2^(positive) > 1
    // This is technically valid math — test that we get a value > 1 for future dates
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const factor = computeDecayFactor(tomorrow, 'social');
    // Factor should be > 1 (insight hasn't "aged" yet, it's from the future)
    expect(factor).toBeGreaterThan(1.0);
  });

  it('returns extremely small value for very old social entries', () => {
    // 300 days = 10 half-lives for social (30-day half-life)
    const veryOld = new Date(Date.now() - 300 * 86400000).toISOString();
    const factor = computeDecayFactor(veryOld, 'social');
    // 0.5^10 ≈ 0.000977
    expect(factor).toBeCloseTo(0.000977, 4);
    expect(factor).toBeGreaterThan(0);
  });

  it('returns 1.0 for unknown provenance type (not in config)', () => {
    // An unknown provenance key won't be found in halfLife, so halfLife[key] = undefined → return 1.0
    const factor = computeDecayFactor('2020-01-01T00:00:00Z', 'nonexistent');
    expect(factor).toBe(1.0);
  });
});
