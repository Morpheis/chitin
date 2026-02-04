/**
 * Maps between Chitin insight format and Carapace contribution format.
 * Handles field name differences and safety checks for promotion.
 */

import type { Insight, InsightType, ContributeInput } from '../types.js';

/** Carapace contribution shape for API submission. */
export interface CarapaceContribution {
  claim: string;
  confidence: number;
  reasoning?: string;
  applicability?: string;
  limitations?: string;
  domainTags?: string[];
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

  result.domainTags = options.domainTags ?? [...insight.tags];

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
 * - Low confidence insights need more testing first
 * - Never-reinforced insights haven't been validated through experience
 * - Insights with personal tags contain human-specific context
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

  if (insight.confidence < MIN_PROMOTE_CONFIDENCE) {
    reasons.push(`Low confidence (${insight.confidence}) — consider testing more before sharing`);
  }

  if (insight.reinforcementCount < MIN_PROMOTE_REINFORCEMENT) {
    reasons.push(`Never reinforced — insight hasn't been validated through repeated experience`);
  }

  const hasPersonalTags = insight.tags.some(t => PERSONAL_TAGS.has(t.toLowerCase()));
  if (hasPersonalTags) {
    reasons.push('Contains personal/human-specific tags — review content before sharing');
  }

  const promotable = options.force ? true : reasons.length === 0;

  return { promotable, reasons };
}
