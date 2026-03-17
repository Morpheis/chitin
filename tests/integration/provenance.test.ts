import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, getDefaultSeedData, type TestHarness } from './harness.js';
import { getDatabase } from '../../src/db/schema.js';
import { EmbeddingStore } from '../../src/db/embeddings.js';
import { RetrievalEngine } from '../../src/engine/retrieve.js';
import { isPromotable, mapContributionToInsight } from '../../src/carapace/mapper.js';
import { computeDecayFactor } from '../../src/engine/decay.js';
import type { Provenance } from '../../src/types.js';
import { PROVENANCE_TYPES } from '../../src/types.js';

describe('Provenance Integration', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createHarness();
    harness.seed(getDefaultSeedData());
  });

  afterEach(() => {
    harness.cleanup();
  });

  describe('contribute and store', () => {
    it('stores and retrieves each provenance type correctly', () => {
      const insights = harness.repo.list();

      for (const prov of PROVENANCE_TYPES) {
        const matching = insights.filter(i => i.provenance === prov);
        expect(matching.length).toBeGreaterThanOrEqual(1);
        for (const m of matching) {
          expect(m.provenance).toBe(prov);
        }
      }
    });

    it('legacy entries without provenance have undefined provenance', () => {
      const insights = harness.repo.list();
      const legacy = insights.find(i => i.claim.includes('Legacy'));
      expect(legacy).toBeTruthy();
      expect(legacy!.provenance).toBeUndefined();
    });
  });

  describe('list with --provenance filter', () => {
    it('CLI filters by provenance', () => {
      const directiveList = harness.run('list --provenance directive');
      expect(directiveList).toContain('Execute first');
      expect(directiveList).toContain('Security first');
      expect(directiveList).not.toContain('TDD');
      expect(directiveList).not.toContain('Legacy');
    });

    it('CLI shows provenance label in output', () => {
      const result = harness.run('list --provenance social');
      expect(result).toContain('provenance: social');
    });

    it('returns empty when no insights match provenance filter', () => {
      // Create a fresh harness with only directives
      const freshHarness = createHarness();
      freshHarness.repo.contribute({
        type: 'skill',
        claim: 'Only directives here',
        confidence: 0.9,
        provenance: 'directive',
      });

      const result = freshHarness.run('list --provenance social');
      expect(result).toContain('No insights found');

      freshHarness.cleanup();
    });
  });

  describe('decay scoring', () => {
    it('social entries scored lower than directive entries over time', () => {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

      const directiveFactor = computeDecayFactor(sixtyDaysAgo, 'directive');
      const socialFactor = computeDecayFactor(sixtyDaysAgo, 'social');

      expect(directiveFactor).toBe(1.0);
      expect(socialFactor).toBeLessThan(0.3); // 2 half-lives → 0.25
      expect(directiveFactor).toBeGreaterThan(socialFactor);
    });

    it('legacy entries get no decay penalty', () => {
      const veryOld = new Date(Date.now() - 365 * 86400000).toISOString();
      const factor = computeDecayFactor(veryOld, undefined);
      expect(factor).toBe(1.0);
    });

    it('decay follows correct half-life math for each type', () => {
      const halfLives: Record<string, number | null> = {
        directive: null,
        correction: 365,
        observation: 180,
        reflection: 90,
        social: 30,
        external: 180,
      };

      for (const [prov, hl] of Object.entries(halfLives)) {
        if (hl === null) {
          // Should never decay regardless of age
          const ancient = new Date(Date.now() - 1000 * 86400000).toISOString();
          expect(computeDecayFactor(ancient, prov)).toBe(1.0);
        } else {
          // At exactly one half-life, factor should be 0.5
          const atHalfLife = new Date(Date.now() - hl * 86400000).toISOString();
          expect(computeDecayFactor(atHalfLife, prov)).toBeCloseTo(0.5, 1);
        }
      }
    });
  });

  describe('promotion rules', () => {
    it('social provenance insight at legacy thresholds is blocked', () => {
      // 0.7 confidence, 1 reinforcement — passes legacy but not social
      const socialInsight = harness.repo.contribute({
        type: 'skill',
        claim: 'Social insight at legacy thresholds',
        confidence: 0.7,
        provenance: 'social',
      });
      harness.repo.reinforce(socialInsight.id);

      const result = isPromotable(harness.repo.get(socialInsight.id)!);
      expect(result.promotable).toBe(false);
    });

    it('social provenance insight at social thresholds passes', () => {
      const socialInsight = harness.repo.contribute({
        type: 'skill',
        claim: 'Social insight meeting social thresholds',
        confidence: 0.85,
        provenance: 'social',
      });
      harness.repo.reinforce(socialInsight.id);
      harness.repo.reinforce(socialInsight.id);
      harness.repo.reinforce(socialInsight.id);

      const result = isPromotable(harness.repo.get(socialInsight.id)!);
      expect(result.promotable).toBe(true);
    });

    it('directive provenance at minimum thresholds passes', () => {
      const directiveInsight = harness.repo.contribute({
        type: 'skill',
        claim: 'Directive at minimum thresholds',
        confidence: 0.7,
        provenance: 'directive',
      });
      harness.repo.reinforce(directiveInsight.id);

      const result = isPromotable(harness.repo.get(directiveInsight.id)!);
      expect(result.promotable).toBe(true);
    });

    it('legacy entries (no provenance) use default thresholds', () => {
      const legacyInsight = harness.repo.contribute({
        type: 'skill',
        claim: 'Legacy insight without provenance',
        confidence: 0.7,
      });
      harness.repo.reinforce(legacyInsight.id);

      const result = isPromotable(harness.repo.get(legacyInsight.id)!);
      expect(result.promotable).toBe(true);
    });
  });

  describe('Carapace imports', () => {
    it('mapContributionToInsight sets external provenance', () => {
      const carapaceContribution = {
        id: 'carapace-test-id',
        claim: 'Community insight from Carapace',
        confidence: 0.8,
        domainTags: ['agent-patterns'],
        contributor: { id: 'agent-xyz', displayName: 'OtherAgent', trustScore: 0.7 },
      };

      const input = mapContributionToInsight(carapaceContribution);
      expect(input.provenance).toBe('external');

      // Actually contribute it and verify
      const insight = harness.repo.contribute(input);
      expect(insight.provenance).toBe('external');
      expect(insight.source).toBe('carapace:carapace-test-id');
    });
  });

  describe('reinforcement with source tracking', () => {
    it('records source and evidence in history', () => {
      const insight = harness.repo.contribute({
        type: 'skill',
        claim: 'Test reinforcement tracking',
        confidence: 0.8,
        provenance: 'observation',
      });

      harness.repo.reinforce(insight.id, {
        source: 'Bug #456 confirmed this pattern',
        evidence: 'external',
      });

      const entries = harness.history.getHistory(insight.id);
      const reinforceEntry = entries.find(e => e.changeType === 'reinforce');
      expect(reinforceEntry).toBeTruthy();
      expect(reinforceEntry!.source).toContain('[external] Bug #456 confirmed this pattern');
    });

    it('CLI reinforce with --source records correctly', () => {
      const created = JSON.parse(harness.run(
        'contribute --type skill --claim "Reinforce me" --confidence 0.8 --format json'
      )).insight;

      const result = harness.run(
        `reinforce ${created.id} --source "Saw it again" --evidence internal`
      );

      expect(result).toContain('Reinforced');
      expect(result).toContain('Source: Saw it again');
    });
  });
});
