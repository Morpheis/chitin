import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI = 'npx tsx src/index.ts';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-embed-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function run(args: string, dbPath: string, env?: Record<string, string>): string {
  return execSync(`${CLI} --db "${dbPath}" ${args}`, {
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf-8',
    timeout: 15000,
    env: { ...process.env, ...env },
  }).trim();
}

function runWithStderr(args: string, dbPath: string, env?: Record<string, string>): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(`${CLI} --db "${dbPath}" ${args}`, {
      cwd: path.resolve(import.meta.dirname, '../..'),
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env, ...env },
    }).trim();
    return { stdout, stderr: '' };
  } catch (e: any) {
    return { stdout: e.stdout?.trim() ?? '', stderr: e.stderr?.trim() ?? '' };
  }
}

describe('CLI embed commands', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    run('init', dbPath);
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  describe('embed-status', () => {
    it('shows zero status on empty db', () => {
      const result = run('embed-status', dbPath);
      expect(result).toContain('Total insights: 0');
      expect(result).toContain('With embeddings: 0');
      expect(result).toContain('Missing embeddings: 0');
    });

    it('shows missing count after contributing insights', () => {
      run('contribute --type behavioral --claim "Test insight" --confidence 0.8', dbPath);
      run('contribute --type personality --claim "Another insight" --confidence 0.7', dbPath);

      const result = run('embed-status', dbPath);
      expect(result).toContain('Total insights: 2');
      expect(result).toContain('With embeddings: 0');
      expect(result).toContain('Missing embeddings: 2');
    });

    it('shows JSON format', () => {
      run('contribute --type behavioral --claim "Test" --confidence 0.8', dbPath);

      const result = run('embed-status --format json', dbPath);
      const parsed = JSON.parse(result);
      expect(parsed.total).toBe(1);
      expect(parsed.embedded).toBe(0);
      expect(parsed.missing).toBe(1);
      expect(parsed.provider).toBeNull();
    });
  });

  describe('embed', () => {
    it('fails gracefully when API key is missing', () => {
      run('contribute --type behavioral --claim "Test" --confidence 0.8', dbPath);

      const { stderr } = runWithStderr('embed', dbPath, { VOYAGE_API_KEY: '' });
      expect(stderr).toContain('Missing API key');
    });

    it('shows nothing to embed when no insights exist', () => {
      // Need a valid API key env var set but no insights
      const result = run('embed', dbPath, { VOYAGE_API_KEY: 'fake-key' });
      expect(result).toContain('No insights to embed');
    });
  });
});
