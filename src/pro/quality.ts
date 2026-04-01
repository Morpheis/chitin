/**
 * Chitin Pro: Insight Quality Scoring
 * 
 * Calculates a quality score for each insight based on:
 * - Recall frequency (how often it's been retrieved/recalled)
 * - Reinforcement count (how many times it's been reinforced)
 * - Age (older insights that are still active are higher quality)
 * - Confidence level
 * - Staleness (time since last retrieval)
 * 
 * Quality score: 0.0 - 1.0
 */

import type { Insight } from '../types.js';

export interface QualityScore {
  insightId: string;
  claim: string;
  type: string;
  quality: number;        // 0.0 - 1.0 overall quality
  components: {
    engagement: number;   // Based on reinforcement count
    freshness: number;    // Inverse of staleness
    maturity: number;     // Age-weighted (older + active = better)
    confidence: number;   // Direct confidence value
  };
  status: 'thriving' | 'healthy' | 'fading' | 'stale' | 'dormant';
  recommendation?: string;
  daysSinceLastRecall: number | null;
  ageInDays: number;
}

export interface QualityReport {
  totalInsights: number;
  averageQuality: number;
  distribution: {
    thriving: number;
    healthy: number;
    fading: number;
    stale: number;
    dormant: number;
  };
  topInsights: QualityScore[];
  staleInsights: QualityScore[];
  recommendations: string[];
}

const WEIGHTS = {
  engagement: 0.30,
  freshness: 0.25,
  maturity: 0.20,
  confidence: 0.25,
};

// How many reinforcements count as "high engagement"
const HIGH_ENGAGEMENT_THRESHOLD = 5;

// Days since last recall before considered "stale"
const STALE_DAYS = 30;

// Days since last recall before considered "dormant"
const DORMANT_DAYS = 90;

function daysBetween(dateStr: string, now: Date): number {
  const date = new Date(dateStr);
  return Math.max(0, (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export function scoreInsight(insight: Insight, now: Date = new Date()): QualityScore {
  const ageInDays = daysBetween(insight.createdAt, now);
  
  // Engagement: reinforcement count, normalized with diminishing returns
  // 0 reinforcements = 0.1, 1 = 0.4, 3 = 0.7, 5+ = 0.9+
  const engagement = Math.min(1.0, 0.1 + (1 - Math.exp(-insight.reinforcementCount / 3)) * 0.9);
  
  // Freshness: how recently was this insight recalled?
  let freshness: number;
  let daysSinceLastRecall: number | null = null;
  
  if (insight.lastRetrievedAt) {
    daysSinceLastRecall = daysBetween(insight.lastRetrievedAt, now);
    // Exponential decay: 0 days = 1.0, 30 days = 0.37, 90 days = 0.05
    freshness = Math.exp(-daysSinceLastRecall / STALE_DAYS);
  } else {
    // Never recalled — give a small freshness boost if new (< 7 days), else low
    freshness = ageInDays < 7 ? 0.5 : 0.1;
    daysSinceLastRecall = null;
  }
  
  // Maturity: older insights that are still being used are more valuable
  // Combines age with engagement — old and engaged = high maturity
  const ageScore = Math.min(1.0, ageInDays / 90); // Maxes at ~90 days
  const maturity = ageScore * engagement;
  
  // Confidence: direct from insight
  const confidence = insight.confidence;
  
  // Weighted quality score
  const quality = Math.min(1.0,
    WEIGHTS.engagement * engagement +
    WEIGHTS.freshness * freshness +
    WEIGHTS.maturity * maturity +
    WEIGHTS.confidence * confidence
  );
  
  // Determine status
  let status: QualityScore['status'];
  if (quality >= 0.7) {
    status = 'thriving';
  } else if (quality >= 0.5) {
    status = 'healthy';
  } else if (daysSinceLastRecall !== null && daysSinceLastRecall > DORMANT_DAYS) {
    status = 'dormant';
  } else if (daysSinceLastRecall !== null && daysSinceLastRecall > STALE_DAYS) {
    status = 'stale';
  } else if (quality >= 0.3) {
    status = 'fading';
  } else {
    status = 'dormant';
  }
  
  // Generate recommendation
  let recommendation: string | undefined;
  if (status === 'dormant') {
    recommendation = 'Consider archiving — not recalled in 90+ days';
  } else if (status === 'stale') {
    recommendation = 'Review and reinforce if still relevant, or archive';
  } else if (status === 'fading' && insight.reinforcementCount === 0) {
    recommendation = 'Never reinforced — validate with experience or archive';
  } else if (status === 'thriving' && insight.confidence < 0.9) {
    recommendation = 'Strong engagement — consider reinforcing to boost confidence';
  }
  
  return {
    insightId: insight.id,
    claim: insight.claim,
    type: insight.type,
    quality: Math.round(quality * 1000) / 1000,
    components: {
      engagement: Math.round(engagement * 1000) / 1000,
      freshness: Math.round(freshness * 1000) / 1000,
      maturity: Math.round(maturity * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
    },
    status,
    recommendation,
    daysSinceLastRecall,
    ageInDays: Math.round(ageInDays),
  };
}

export function generateQualityReport(insights: Insight[], now: Date = new Date()): QualityReport {
  const scores = insights.map(i => scoreInsight(i, now));
  
  const distribution = {
    thriving: 0,
    healthy: 0,
    fading: 0,
    stale: 0,
    dormant: 0,
  };
  
  let totalQuality = 0;
  for (const score of scores) {
    distribution[score.status]++;
    totalQuality += score.quality;
  }
  
  const averageQuality = scores.length > 0 ? totalQuality / scores.length : 0;
  
  // Top insights by quality
  const topInsights = [...scores]
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 10);
  
  // Stale + dormant insights
  const staleInsights = scores
    .filter(s => s.status === 'stale' || s.status === 'dormant')
    .sort((a, b) => a.quality - b.quality);
  
  // Generate report-level recommendations
  const recommendations: string[] = [];
  
  if (staleInsights.length > scores.length * 0.3) {
    recommendations.push(`${staleInsights.length} insights (${Math.round(staleInsights.length / scores.length * 100)}%) are stale or dormant — consider a cleanup session`);
  }
  
  if (distribution.dormant > 5) {
    recommendations.push(`${distribution.dormant} dormant insights haven't been recalled in 90+ days — archive candidates`);
  }
  
  const neverReinforced = scores.filter(s => s.components.engagement <= 0.1);
  if (neverReinforced.length > scores.length * 0.5) {
    recommendations.push(`${neverReinforced.length} insights have never been reinforced — validate them or they'll decay`);
  }
  
  const avgConfidence = scores.reduce((sum, s) => sum + s.components.confidence, 0) / (scores.length || 1);
  if (avgConfidence < 0.7) {
    recommendations.push(`Average confidence is ${(avgConfidence * 100).toFixed(0)}% — consider reinforcing your best insights`);
  }
  
  if (scores.length > 100) {
    recommendations.push(`${scores.length} total insights — consider merging duplicates or archiving low-value ones`);
  }
  
  return {
    totalInsights: scores.length,
    averageQuality: Math.round(averageQuality * 1000) / 1000,
    distribution,
    topInsights,
    staleInsights,
    recommendations,
  };
}

export function formatQualityReport(report: QualityReport): string {
  const lines: string[] = [];
  
  lines.push('Chitin Pro — Insight Quality Report');
  lines.push('════════════════════════════════════');
  lines.push('');
  lines.push(`Total insights: ${report.totalInsights}`);
  lines.push(`Average quality: ${(report.averageQuality * 100).toFixed(1)}%`);
  lines.push('');
  
  // Distribution
  lines.push('Distribution:');
  const statusEmoji: Record<string, string> = {
    thriving: '🟢',
    healthy: '🔵',
    fading: '🟡',
    stale: '🟠',
    dormant: '🔴',
  };
  for (const [status, count] of Object.entries(report.distribution)) {
    if (count > 0) {
      const emoji = statusEmoji[status] || '•';
      const pct = ((count / report.totalInsights) * 100).toFixed(0);
      lines.push(`  ${emoji} ${status}: ${count} (${pct}%)`);
    }
  }
  lines.push('');
  
  // Top insights
  if (report.topInsights.length > 0) {
    lines.push('Top Insights:');
    for (const score of report.topInsights.slice(0, 5)) {
      const pct = (score.quality * 100).toFixed(0);
      const claim = score.claim.length > 60 ? score.claim.slice(0, 60) + '...' : score.claim;
      lines.push(`  ${statusEmoji[score.status]} [${pct}%] ${claim}`);
    }
    lines.push('');
  }
  
  // Stale insights
  if (report.staleInsights.length > 0) {
    lines.push('Needs Attention:');
    for (const score of report.staleInsights.slice(0, 5)) {
      const pct = (score.quality * 100).toFixed(0);
      const claim = score.claim.length > 60 ? score.claim.slice(0, 60) + '...' : score.claim;
      const days = score.daysSinceLastRecall ? `${Math.round(score.daysSinceLastRecall)}d ago` : 'never recalled';
      lines.push(`  ${statusEmoji[score.status]} [${pct}%] ${claim} (${days})`);
    }
    lines.push('');
  }
  
  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const rec of report.recommendations) {
      lines.push(`  • ${rec}`);
    }
  }
  
  return lines.join('\n');
}
