/**
 * Maps between Chitin insight format and Carapace contribution format.
 * Handles field name differences and safety checks for promotion.
 */

import type { Insight, InsightType, Provenance, ContributeInput } from '../types.js';

/** Carapace contribution shape for API submission. */
export interface CarapaceContribution {
  claim: string;
  confidence: number;
  reasoning?: string;
  applicability?: string;
  limitations?: string;
  domainTags?: string[];
  provenance?: string;
}

/** Partial Carapace contribution from API response (query results). */
export interface CarapaceContributionResponse {
  id: string;
  claim: string;
  confidence: number;
  reasoning?: string | null;
  applicability?: string | null;
  limitations?: string | null;
  domainTags: string[];
  contributor: { id: string; displayName: string; trustScore: number };
}

export interface PromotabilityResult {
  promotable: boolean;
  reasons: string[];
}

export interface MapToContributionOptions {
  domainTags?: string[];
}

export interface MapToInsightOptions {
  type?: InsightType;
}

/** Tags that indicate an insight is personal/specific to the human. */
const PERSONAL_TAGS = new Set(['boss', 'human', 'personal', 'private', 'ken']);

const MIN_PROMOTE_CONFIDENCE = 0.7;
const MIN_PROMOTE_REINFORCEMENT = 1;

/** Provenance-specific promotion thresholds. */
const PROMOTION_THRESHOLDS: Record<string, { minConfidence: number; minReinforcement: number }> = {
  directive:   { minConfidence: 0.7, minReinforcement: 1 },
  correction:  { minConfidence: 0.7, minReinforcement: 1 },
  observation: { minConfidence: 0.75, minReinforcement: 2 },
  reflection:  { minConfidence: 0.8, minReinforcement: 2 },
  social:      { minConfidence: 0.85, minReinforcement: 3 },
  external:    { minConfidence: 0.8, minReinforcement: 2 },
  undefined:   { minConfidence: 0.7, minReinforcement: 1 },  // legacy
};

/**
 * Map a Chitin insight to a Carapace contribution for API submission.
 *
 * Field mapping:
 *   context → applicability
 *   tags → domainTags
 */
export function mapInsightToContribution(
  insight: Insight,
  options: MapToContributionOptions = {},
): CarapaceContribution {
  const result: CarapaceContribution = {
    claim: insight.claim,
    confidence: insight.confidence,
  };

  if (insight.reasoning) result.reasoning = insight.reasoning;
  if (insight.context) result.applicability = insight.context;
  if (insight.limitations) result.limitations = insight.limitations;

  const baseTags = options.domainTags ?? [...insight.tags];
  if (insight.provenance) {
    baseTags.push(`provenance:${insight.provenance}`);
    result.provenance = insight.provenance;
  }
  result.domainTags = baseTags;

  return result;
}

/**
 * Map a Carapace contribution response to a Chitin ContributeInput.
 *
 * Field mapping:
 *   applicability → context
 *   domainTags → tags
 *   source set to "carapace:<id>"
 */
export function mapContributionToInsight(
  contribution: CarapaceContributionResponse,
  options: MapToInsightOptions = {},
): ContributeInput {
  const result: ContributeInput = {
    type: options.type ?? 'skill',
    claim: contribution.claim,
    confidence: contribution.confidence,
    tags: [...contribution.domainTags],
    source: `carapace:${contribution.id}`,
    provenance: 'external',
  };

  if (contribution.reasoning) result.reasoning = contribution.reasoning;
  if (contribution.applicability) result.context = contribution.applicability;
  if (contribution.limitations) result.limitations = contribution.limitations;

  return result;
}

/**
 * Check whether an insight is suitable for promotion to Carapace.
 *
 * Rules:
 * - Relational insights are never promotable (personal to the human)
 * - Provenance-based confidence and reinforcement thresholds apply
 * - Insights with personal tags contain human-specific context
 *
 * Provenance thresholds (higher bar for less-trusted origins):
 *   directive/correction: 0.7 confidence, 1 reinforcement
 *   observation: 0.75 confidence, 2 reinforcements
 *   reflection/external: 0.8 confidence, 2 reinforcements
 *   social: 0.85 confidence, 3 reinforcements
 *
 * When force=true, returns promotable=true but still lists warnings.
 */
export function isPromotable(
  insight: Insight,
  options: { force?: boolean } = {},
): PromotabilityResult {
  const reasons: string[] = [];

  if (insight.type === 'relational') {
    reasons.push('Relational insights are personal and should not be shared publicly');
  }

  // Use provenance-specific thresholds, falling back to legacy defaults
  const provenanceKey = insight.provenance ?? 'undefined';
  const thresholds = PROMOTION_THRESHOLDS[provenanceKey] ?? {
    minConfidence: MIN_PROMOTE_CONFIDENCE,
    minReinforcement: MIN_PROMOTE_REINFORCEMENT,
  };

  if (insight.confidence < thresholds.minConfidence) {
    reasons.push(`Low confidence (${insight.confidence}) — ${provenanceKey} provenance requires ≥${thresholds.minConfidence}`);
  }

  if (insight.reinforcementCount < thresholds.minReinforcement) {
    const label = thresholds.minReinforcement === 1
      ? 'Never reinforced — insight hasn\'t been validated through repeated experience'
      : `Insufficient reinforcement (${insight.reinforcementCount}×) — ${provenanceKey} provenance requires ≥${thresholds.minReinforcement}`;
    reasons.push(label);
  }

  const hasPersonalTags = insight.tags.some(t => PERSONAL_TAGS.has(t.toLowerCase()));
  if (hasPersonalTags) {
    reasons.push('Contains personal/human-specific tags — review content before sharing');
  }

  const promotable = options.force ? true : reasons.length === 0;

  return { promotable, reasons };
}
