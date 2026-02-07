export const INSIGHT_TYPES = ['behavioral', 'personality', 'relational', 'principle', 'skill', 'trigger'] as const;
export type InsightType = typeof INSIGHT_TYPES[number];

export interface Insight {
  id: string;
  type: InsightType;
  claim: string;
  reasoning?: string;
  context?: string;
  limitations?: string;
  confidence: number;
  tags: string[];
  source?: string;

  // Trigger-specific fields (only used when type === 'trigger')
  condition?: string;  // The triggering event/situation
  avoid?: boolean;     // If true, this is a behavior to avoid rather than adopt

  createdAt: string;
  updatedAt: string;
  reinforcementCount: number;
  lastRetrievedAt?: string;
}

export interface ContributeInput {
  type: InsightType;
  claim: string;
  reasoning?: string;
  context?: string;
  limitations?: string;
  confidence: number;
  tags?: string[];
  source?: string;

  // Trigger-specific fields
  condition?: string;  // The triggering event/situation
  avoid?: boolean;     // If true, this is a behavior to avoid
}

export interface UpdateInput {
  claim?: string;
  reasoning?: string;
  context?: string;
  limitations?: string;
  confidence?: number;
  tags?: string[];
  source?: string;

  // Trigger-specific fields
  condition?: string;
  avoid?: boolean;
}

export interface RetrieveOptions {
  query: string;
  budget?: number;         // max tokens for output (default 2000)
  maxResults?: number;     // max insights to return (default 15)
  types?: InsightType[];   // filter by type
  tags?: string[];         // filter by tag
  minConfidence?: number;  // minimum confidence threshold
}

export interface RetrieveResult {
  insights: Insight[];
  context: string;         // marshaled compact output
  tokenEstimate: number;
}

export interface ContributeResult {
  insight: Insight;
  conflicts: Array<{
    insight: Insight;
    similarity: number;
    tensionScore: number;
    tensionReason: string;
    conflictScore: number;
  }>;
}
