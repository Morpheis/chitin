import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI_PATH = path.join(import.meta.dirname, '../../src/index.ts');

function run(args: string[]): string {
  return execFileSync('npx', ['tsx', CLI_PATH, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function contribute(dbPath: string, type: string, claim: string, confidence: string, tags?: string): string {
  const args = ['contribute', '--type', type, '--claim', claim, '--confidence', confidence, '--format', 'json', '--db', dbPath];
  if (tags) args.push('--tags', tags);
  const output = run(args);
  return JSON.parse(output).insight.id;
}

describe('similar command (CLI)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    run(['init', '--db', dbPath]);
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('finds similar insights', () => {
    contribute(dbPath, 'behavioral', 'Execute tasks quickly and move fast', '0.8');
    contribute(dbPath, 'behavioral', 'Execute tasks, narrate minimally', '0.7');
    contribute(dbPath, 'skill', 'TDD means writing tests first', '0.9');

    const output = run(['similar', 'Execute tasks quickly', '--db', dbPath]);
    expect(output).toContain('similar insight');
    expect(output).toContain('Execute tasks');
  });

  it('reports no matches when none found', () => {
    contribute(dbPath, 'skill', 'TDD means writing tests first', '0.9');

    const output = run(['similar', 'Boss prefers direct communication', '--threshold', '0.5', '--db', dbPath]);
    expect(output).toContain('No similar insights');
  });

  it('outputs JSON format', () => {
    contribute(dbPath, 'behavioral', 'Execute tasks quickly', '0.8');

    const output = run(['similar', 'Execute tasks fast', '--format', 'json', '--db', dbPath]);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe('merge command (CLI)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    run(['init', '--db', dbPath]);
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('merges two insights via CLI', () => {
    const targetId = contribute(dbPath, 'behavioral', 'Execute first on clear tasks', '0.8', 'boss');
    const sourceId = contribute(dbPath, 'behavioral', 'Act quickly, narrate minimally', '0.9', 'communication');

    const output = run(['merge', sourceId, targetId, '--db', dbPath]);
    expect(output).toContain('Merged into');
    expect(output).toContain(targetId);

    // Source should be gone
    try {
      run(['get', sourceId, '--db', dbPath]);
      expect.unreachable('Should have thrown');
    } catch {
      // Expected — get exits with code 1
    }
  });

  it('allows claim override', () => {
    const targetId = contribute(dbPath, 'behavioral', 'Old claim', '0.8');
    const sourceId = contribute(dbPath, 'behavioral', 'Other claim', '0.7');

    const output = run(['merge', sourceId, targetId, '--claim', 'Combined insight', '--db', dbPath]);
    expect(output).toContain('Combined insight');
  });

  it('outputs JSON format', () => {
    const targetId = contribute(dbPath, 'behavioral', 'A', '0.8');
    const sourceId = contribute(dbPath, 'behavioral', 'B', '0.7');

    const output = run(['merge', sourceId, targetId, '--format', 'json', '--db', dbPath]);
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe(targetId);
  });
});
