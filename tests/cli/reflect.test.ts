import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI_PATH = path.join(import.meta.dirname, '../../src/index.ts');

function run(args: string[], env?: Record<string, string>): string {
  return execFileSync('npx', ['tsx', CLI_PATH, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: 10000,
  }).trim();
}

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `chitin-reflect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('reflect command', () => {
  let configDir: string;
  let pendingPath: string;
  let dbPath: string;

  beforeEach(() => {
    configDir = tmpDir();
    pendingPath = path.join(configDir, 'pending-reflection.json');
    dbPath = path.join(configDir, 'insights.db');
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('shows pending reflections from file', () => {
    const entries = [
      { sessionKey: 'agent:main:main', timestamp: '2026-02-03T07:03:53.511Z', reason: 'new' },
      { sessionKey: 'agent:sub:task', timestamp: '2026-02-03T08:15:00.000Z', reason: 'reset' },
    ];
    fs.writeFileSync(pendingPath, JSON.stringify(entries));

    const output = run(['reflect', '--pending-path', pendingPath, '--db', dbPath]);

    expect(output).toContain('agent:main:main');
    expect(output).toContain('new');
    expect(output).toContain('agent:sub:task');
    expect(output).toContain('reset');
    expect(output).toContain('2 pending reflection(s)');
  });

  it('reports no pending reflections when file is empty array', () => {
    fs.writeFileSync(pendingPath, '[]');

    const output = run(['reflect', '--pending-path', pendingPath, '--db', dbPath]);
    expect(output).toContain('No pending reflections');
  });

  it('reports no pending reflections when file does not exist', () => {
    const output = run(['reflect', '--pending-path', path.join(configDir, 'nonexistent.json'), '--db', dbPath]);
    expect(output).toContain('No pending reflections');
  });

  it('clears pending reflections with --clear', () => {
    const entries = [
      { sessionKey: 'agent:main:main', timestamp: '2026-02-03T07:03:53.511Z', reason: 'new' },
    ];
    fs.writeFileSync(pendingPath, JSON.stringify(entries));

    const output = run(['reflect', '--pending-path', pendingPath, '--clear', '--db', dbPath]);
    expect(output).toContain('Cleared');

    // File should now be empty array
    const remaining = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    expect(remaining).toEqual([]);
  });

  it('outputs JSON format when requested', () => {
    const entries = [
      { sessionKey: 'agent:main:main', timestamp: '2026-02-03T07:03:53.511Z', reason: 'new' },
    ];
    fs.writeFileSync(pendingPath, JSON.stringify(entries));

    const output = run(['reflect', '--pending-path', pendingPath, '--format', 'json', '--db', dbPath]);
    const parsed = JSON.parse(output);

    expect(parsed.pending).toHaveLength(1);
    expect(parsed.pending[0].sessionKey).toBe('agent:main:main');
  });

  it('includes insight stats in output', () => {
    // Seed some insights first
    run(['contribute', '--type', 'behavioral', '--claim', 'Test insight', '--confidence', '0.8', '--db', dbPath]);

    const entries = [
      { sessionKey: 'agent:main:main', timestamp: '2026-02-03T07:03:53.511Z', reason: 'new' },
    ];
    fs.writeFileSync(pendingPath, JSON.stringify(entries));

    const output = run(['reflect', '--pending-path', pendingPath, '--db', dbPath]);
    expect(output).toContain('1 insight(s)');
  });
});
