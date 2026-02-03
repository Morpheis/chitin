import type { InsightType } from '../types.js';

export type ContextCategory = 'coding' | 'communication' | 'ethical' | 'creative' | 'general';

export interface DetectedContext {
  category: ContextCategory;
  typeBoosts: Record<InsightType, number>;
}

interface SignalPattern {
  keywords: string[];
  category: ContextCategory;
  weight: number;
}

const SIGNALS: SignalPattern[] = [
  {
    category: 'coding',
    weight: 1.0,
    keywords: [
      'code', 'function', 'bug', 'api', 'build', 'deploy', 'test', 'git',
      'commit', 'push', 'pull', 'branch', 'merge', 'refactor', 'debug',
      'typescript', 'javascript', 'python', 'rust', 'html', 'css',
      'database', 'sql', 'server', 'endpoint', 'cli', 'npm', 'package',
      'compile', 'error', 'fix', 'implement', 'architect', 'repo',
      'docker', 'container', 'netlify', 'website', 'tdd', 'lint',
      'schema', 'migration', 'query', 'install', 'config',
    ],
  },
  {
    category: 'communication',
    weight: 1.0,
    keywords: [
      'boss', 'team', 'respond', 'reply', 'message', 'email', 'slack',
      'tell', 'ask', 'explain', 'communicate', 'feedback', 'meeting',
      'person', 'people', 'coworker', 'colleague', 'client', 'user',
      'conversation', 'discuss', 'chat', 'tone', 'polite', 'direct',
    ],
  },
  {
    category: 'ethical',
    weight: 1.2, // Slightly higher weight — ethical signals should be strong
    keywords: [
      'ethical', 'moral', 'right', 'wrong', 'honest', 'honesty', 'lie',
      'private', 'privacy', 'security', 'trust', 'principle', 'value',
      'should', 'fair', 'integrity', 'permission', 'consent', 'safe',
      'appropriate', 'harmful', 'responsible', 'christian', 'faith',
    ],
  },
  {
    category: 'creative',
    weight: 0.9,
    keywords: [
      'story', 'write', 'creative', 'fun', 'humor', 'joke', 'poem',
      'imagine', 'design', 'art', 'style', 'voice', 'personality',
      'dream', 'philosophical', 'reflect', 'muse', 'inspire',
    ],
  },
];

const BOOST_PROFILES: Record<ContextCategory, Record<InsightType, number>> = {
  coding: {
    skill: 1.8,
    behavioral: 1.3,
    principle: 1.0,
    personality: 0.7,
    relational: 0.8,
  },
  communication: {
    relational: 1.8,
    behavioral: 1.5,
    personality: 1.2,
    principle: 1.0,
    skill: 0.6,
  },
  ethical: {
    principle: 2.0,
    behavioral: 1.2,
    personality: 1.0,
    relational: 1.0,
    skill: 0.5,
  },
  creative: {
    personality: 1.8,
    behavioral: 1.2,
    relational: 1.0,
    principle: 0.8,
    skill: 0.6,
  },
  general: {
    personality: 1.0,
    behavioral: 1.0,
    relational: 1.0,
    principle: 1.0,
    skill: 1.0,
  },
};

/**
 * Detect the context category of an incoming message/query.
 * Uses keyword matching with weighted scoring to classify the
 * dominant context, then returns appropriate type boost multipliers.
 * 
 * This is intentionally simple — keyword-based, no ML.
 * The agent's LLM already understands context deeply;
 * this just needs to be "good enough" for boost selection.
 */
export function detectContext(text: string): DetectedContext {
  if (!text || text.trim().length === 0) {
    return { category: 'general', typeBoosts: BOOST_PROFILES.general };
  }

  const lower = text.toLowerCase();
  const words = new Set(lower.split(/\W+/).filter(w => w.length > 0));

  const scores: Record<ContextCategory, number> = {
    coding: 0,
    communication: 0,
    ethical: 0,
    creative: 0,
    general: 0,
  };

  for (const signal of SIGNALS) {
    let matches = 0;
    for (const keyword of signal.keywords) {
      // Check both word-level match and substring match for compound words
      if (words.has(keyword) || lower.includes(keyword)) {
        matches++;
      }
    }
    scores[signal.category] = matches * signal.weight;
  }

  // Find the category with the highest score
  let bestCategory: ContextCategory = 'general';
  let bestScore = 0;

  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category as ContextCategory;
    }
  }

  // Need at least 1 match to classify as non-general
  if (bestScore < 1) {
    bestCategory = 'general';
  }

  return {
    category: bestCategory,
    typeBoosts: BOOST_PROFILES[bestCategory],
  };
}
