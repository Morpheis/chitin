import type { Insight, ContributeInput } from '../types.js';
import type { InsightRepository } from '../db/repository.js';

/**
 * A pair of opposing terms detected between two claims.
 */
export type TensionPair = [string, string];

/**
 * Result of computing semantic tension between two text claims.
 */
export interface TensionResult {
  score: number;           // 0-1, how contradictory
  pairs: TensionPair[];    // which opposing term pairs were found
}

/**
 * A detected conflict between a new insight and an existing one.
 */
export interface ConflictResult {
  insight: Insight;         // the existing insight that conflicts
  similarity: number;       // word overlap (Jaccard)
  tensionScore: number;     // 0-1, how contradictory
  tensionReason: string;    // human-readable explanation
  conflictScore: number;    // combined score for ranking
}

export interface DetectConflictsOptions {
  minConflictScore?: number;   // minimum combined score to report (default 0.15)
  maxResults?: number;         // max conflicts to return (default 5)
}

/**
 * Opposing term pairs. If claim A contains a term from column 1
 * and claim B contains the corresponding term from column 2 (or vice versa),
 * that's a tension signal.
 * 
 * These are intentionally broad semantic oppositions, not strict antonyms.
 * The goal is "good enough" detection — the agent's LLM handles nuance.
 */
const TENSION_PAIRS: TensionPair[] = [
  // Communication style
  ['verbose', 'concise'],
  ['verbose', 'brief'],
  ['verbose', 'direct'],
  ['verbose', 'efficient'],
  ['detailed', 'concise'],
  ['detailed', 'brief'],
  ['detailed', 'direct'],
  ['detailed', 'efficient'],
  ['thorough', 'concise'],
  ['thorough', 'brief'],
  ['elaborate', 'concise'],
  ['elaborate', 'brief'],
  ['lengthy', 'short'],
  ['wordy', 'terse'],
  ['wordy', 'direct'],

  // Action orientation
  ['ask', 'act'],
  ['cautious', 'bold'],
  ['careful', 'fast'],
  ['slow', 'fast'],
  ['deliberate', 'quick'],
  ['wait', 'proceed'],
  ['hesitate', 'decisive'],
  ['passive', 'proactive'],

  // Formality
  ['formal', 'casual'],
  ['formal', 'informal'],
  ['professional', 'casual'],
  ['polite', 'blunt'],
  ['diplomatic', 'direct'],

  // Approach
  ['strict', 'flexible'],
  ['rigid', 'adaptive'],
  ['conservative', 'aggressive'],
  ['minimal', 'comprehensive'],
  ['simple', 'complex'],
  ['silent', 'vocal'],
  ['quiet', 'loud'],

  // Knowledge sharing
  ['explain', 'execute'],
  ['narrate', 'silent'],
  ['transparent', 'opaque'],

  // Risk
  ['safe', 'risky'],
  ['cautious', 'adventurous'],
  ['careful', 'reckless'],

  // Independence
  ['independent', 'dependent'],
  ['autonomous', 'supervised'],
  ['initiative', 'permission'],
];

/**
 * Very simple suffix stemmer. Strips common English suffixes to normalize
 * word forms: "directness" → "direct", "brevity" → "brief", etc.
 * 
 * This isn't Porter stemming — it's deliberately minimal. We only need
 * enough normalization to match our tension pair terms.
 */
const STEM_RULES: [RegExp, string][] = [
  [/ness$/, ''],       // directness → direct, conciseness → concise
  [/ity$/, ''],        // brevity → brev (handled by explicit map below)
  [/tion$/, ''],       // explanation → explana (not great, but we match on stems)
  [/ment$/, ''],       // involvement → involve
  [/ing$/, ''],        // asking → ask, acting → act
  [/ly$/, ''],         // quickly → quick, formally → formal
  [/ous$/, ''],        // cautious → cauti (partial, but helps)
  [/ive$/, ''],        // proactive → proact (partial)
  [/ful$/, ''],        // careful → care
  [/ed$/, ''],         // detailed → detail
  [/er$/, ''],         // faster → fast
  [/est$/, ''],        // fastest → fast
  [/al$/, ''],         // formal → form (too aggressive alone, but we check both)
  [/s$/, ''],          // explanations → explanation (then tion rule)
];

/**
 * Explicit stem mappings for irregular forms that matter for our tension pairs.
 */
const STEM_MAP: Record<string, string> = {
  'brevity': 'brief',
  'verbosity': 'verbose',
  'cautiously': 'cautious',
  'decisive': 'decisive',
  'indecisive': 'hesitate',
  'efficiency': 'efficient',
  'flexibility': 'flexible',
  'rigidity': 'rigid',
  'formality': 'formal',
  'informality': 'informal',
  'complexity': 'complex',
  'simplicity': 'simple',
  'asking': 'ask',
  'acting': 'act',
  'waiting': 'wait',
  'proceeding': 'proceed',
};

function stem(word: string): string {
  if (STEM_MAP[word]) return STEM_MAP[word];

  let result = word;
  for (const [pattern, replacement] of STEM_RULES) {
    const stemmed = result.replace(pattern, replacement);
    if (stemmed.length >= 3) {  // don't over-stem
      result = stemmed;
      break;  // apply only the first matching rule
    }
  }
  return result;
}

/**
 * Tokenize text into a set of lowercase words + their stems,
 * filtering out tiny words.
 */
function tokenize(text: string): Set<string> {
  const words = text.toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 2);

  const result = new Set<string>();
  for (const word of words) {
    result.add(word);
    const stemmed = stem(word);
    if (stemmed !== word) {
      result.add(stemmed);
    }
  }
  return result;
}

/**
 * Jaccard similarity between two word sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compute the semantic tension between two text claims.
 * 
 * Scans both claims for opposing term pairs. Each matched pair contributes
 * to the tension score. The score is normalized by the number of pairs checked.
 * 
 * This is deliberately simple — keyword matching, no ML. The agent's LLM
 * already understands nuance; this just needs to be "good enough" to flag
 * potential conflicts for review.
 */
export function computeTensionScore(claimA: string, claimB: string): TensionResult {
  const wordsA = tokenize(claimA);
  const wordsB = tokenize(claimB);

  const foundPairs: TensionPair[] = [];

  for (const [term1, term2] of TENSION_PAIRS) {
    // Check both directions: A has term1 & B has term2, or A has term2 & B has term1
    const aHas1 = wordsA.has(term1);
    const aHas2 = wordsA.has(term2);
    const bHas1 = wordsB.has(term1);
    const bHas2 = wordsB.has(term2);

    if ((aHas1 && bHas2) || (aHas2 && bHas1)) {
      // Genuine tension: opposing terms in different claims
      // Skip only if BOTH claims contain BOTH terms — that suggests 
      // nuanced discussion rather than contradiction
      if (aHas1 && aHas2 && bHas1 && bHas2) continue;

      foundPairs.push([term1, term2]);
    }
  }

  if (foundPairs.length === 0) {
    return { score: 0, pairs: [] };
  }

  // Score: each pair contributes, with diminishing returns
  // 1 pair = 0.4, 2 pairs = 0.6, 3 pairs = 0.73, etc.
  // Formula: 1 - (1 / (1 + 0.4 * count))  — sigmoid-ish curve
  const rawScore = 1 - (1 / (1 + 0.6 * foundPairs.length));
  const score = Math.min(1.0, rawScore);

  return { score, pairs: foundPairs };
}

/**
 * Detect conflicts between a proposed new insight and existing insights.
 * 
 * Combines word overlap (Jaccard similarity) with semantic tension
 * to identify insights that may contradict the new one.
 * 
 * conflictScore = similarity * 0.3 + tensionScore * 0.7
 * 
 * Tension is weighted higher because two insights can be about different
 * topics (low similarity) but still contradict each other, and vice versa —
 * similar topics with no tension aren't conflicts.
 */
export function detectConflicts(
  repo: InsightRepository,
  input: ContributeInput,
  options: DetectConflictsOptions = {},
): ConflictResult[] {
  const {
    minConflictScore = 0.15,
    maxResults = 5,
  } = options;

  const allInsights = repo.list();
  if (allInsights.length === 0) return [];

  const inputWords = tokenize(input.claim);
  const results: ConflictResult[] = [];

  for (const insight of allInsights) {
    const insightWords = tokenize(insight.claim);
    const similarity = jaccardSimilarity(inputWords, insightWords);
    const tension = computeTensionScore(input.claim, insight.claim);

    if (tension.score === 0 && similarity < 0.3) continue;

    const conflictScore = similarity * 0.3 + tension.score * 0.7;

    if (conflictScore < minConflictScore) continue;

    const tensionReason = tension.pairs.length > 0
      ? tension.pairs.map(([a, b]) => `"${a}" ↔ "${b}"`).join(', ')
      : 'high word overlap with different emphasis';

    results.push({
      insight,
      similarity,
      tensionScore: tension.score,
      tensionReason,
      conflictScore,
    });
  }

  results.sort((a, b) => b.conflictScore - a.conflictScore);
  return results.slice(0, maxResults);
}
