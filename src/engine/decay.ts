/**
 * Provenance-aware decay for insight retrieval scoring.
 *
 * Different provenance types decay at different rates:
 * - Directives from the operator never decay
 * - Social observations decay quickly (30-day half-life)
 * - Corrections and observations decay moderately
 * - Legacy entries (no provenance) never decay for backward compatibility
 */

export interface DecayConfig {
  enabled: boolean;
  halfLife: Record<string, number | null>;  // provenance → days (null = never decay)
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  enabled: true,
  halfLife: {
    directive: null,       // Never decay — operator instructions
    correction: 365,       // 1 year
    observation: 180,      // 6 months
    reflection: 90,        // 3 months
    social: 30,            // 1 month
    external: 180,         // 6 months (imported from Carapace)
    undefined: null,       // Legacy entries without provenance — never decay
  },
};

/**
 * Compute a decay multiplier for an insight based on its age and provenance.
 *
 * Uses exponential decay: factor = 0.5^(age / halfLife)
 * Returns 1.0 for insights that never decay (null half-life or decay disabled).
 */
export function computeDecayFactor(
  createdAt: string,
  provenance: string | undefined,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  if (!config.enabled) return 1.0;

  const key = provenance ?? 'undefined';
  const halfLife = config.halfLife[key];
  if (halfLife === null || halfLife === undefined) return 1.0;

  const daysSinceCreation = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return Math.pow(0.5, daysSinceCreation / halfLife);
}
