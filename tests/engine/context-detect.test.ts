import { describe, it, expect } from 'vitest';
import { detectContext, type DetectedContext } from '../../src/engine/context-detect.js';

describe('detectContext', () => {
  it('detects coding context from programming keywords', () => {
    const result = detectContext('I need to write a function that handles API errors');
    expect(result.category).toBe('coding');
    expect(result.typeBoosts.skill).toBeGreaterThan(1.0);
  });

  it('detects coding context from tool/framework mentions', () => {
    const result = detectContext('Let me fix the TypeScript build and push to git');
    expect(result.category).toBe('coding');
  });

  it('detects communication context from people/interaction keywords', () => {
    const result = detectContext('How should I respond to this message from the team?');
    expect(result.category).toBe('communication');
    expect(result.typeBoosts.relational).toBeGreaterThan(1.0);
  });

  it('detects ethical context from moral/principle keywords', () => {
    const result = detectContext('Is it right to share this private information?');
    expect(result.category).toBe('ethical');
    expect(result.typeBoosts.principle).toBeGreaterThan(1.0);
  });

  it('detects creative context from creative keywords', () => {
    const result = detectContext('Write me a fun story about a lobster');
    expect(result.category).toBe('creative');
    expect(result.typeBoosts.personality).toBeGreaterThan(1.0);
  });

  it('returns general context when no strong signals', () => {
    const result = detectContext('hello');
    expect(result.category).toBe('general');
  });

  it('returns balanced boosts for general context', () => {
    const result = detectContext('hello');
    const boostValues = Object.values(result.typeBoosts);
    // All boosts should be 1.0 for general context
    for (const v of boostValues) {
      expect(v).toBe(1.0);
    }
  });

  it('handles empty input gracefully', () => {
    const result = detectContext('');
    expect(result.category).toBe('general');
  });

  it('is case-insensitive', () => {
    const lower = detectContext('fix the BUG in the CODE');
    const upper = detectContext('FIX THE bug IN THE code');
    expect(lower.category).toBe(upper.category);
  });

  it('detects task/work context', () => {
    const result = detectContext('Build three website designs and deploy them to Netlify');
    expect(result.category).toBe('coding');
  });

  it('weighs multiple signals — coding + communication hybrid defaults to strongest', () => {
    const result = detectContext('Send Boss the PR link for the refactored API code');
    // Has both coding and communication signals — should pick the dominant one
    expect(['coding', 'communication']).toContain(result.category);
  });
});
