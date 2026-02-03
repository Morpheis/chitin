import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI = 'npx tsx src/index.ts';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `chitin-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function run(args: string, dbPath: string): string {
  return execSync(`${CLI} --db "${dbPath}" ${args}`, {
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf-8',
    timeout: 15000,
  }).trim();
}

describe('CLI', () => {
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

  it('init creates the database', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('contribute and get roundtrip', () => {
    const result = run(
      'contribute --type behavioral --claim "Test claim from CLI" --confidence 0.8 --format json',
      dbPath
    );
    const parsed = JSON.parse(result);
    const insight = parsed.insight;
    expect(insight.id).toBeTruthy();
    expect(insight.claim).toBe('Test claim from CLI');

    const fetched = run(`get ${insight.id} --format json`, dbPath);
    const fetchedParsed = JSON.parse(fetched);
    expect(fetchedParsed.claim).toBe('Test claim from CLI');
  });

  it('list shows contributed insights', () => {
    run('contribute --type behavioral --claim "First insight" --confidence 0.8', dbPath);
    run('contribute --type personality --claim "Second insight" --confidence 0.7', dbPath);

    const result = run('list', dbPath);
    expect(result).toContain('First insight');
    expect(result).toContain('Second insight');
    expect(result).toContain('2 insight(s)');
  });

  it('list filters by type', () => {
    run('contribute --type behavioral --claim "Behavioral one" --confidence 0.8', dbPath);
    run('contribute --type personality --claim "Personality one" --confidence 0.7', dbPath);

    const result = run('list --type behavioral', dbPath);
    expect(result).toContain('Behavioral one');
    expect(result).not.toContain('Personality one');
  });

  it('stats shows counts', () => {
    run('contribute --type behavioral --claim "B1" --confidence 0.8', dbPath);
    run('contribute --type behavioral --claim "B2" --confidence 0.9', dbPath);
    run('contribute --type personality --claim "P1" --confidence 0.7', dbPath);

    const result = run('stats', dbPath);
    expect(result).toContain('Total: 3');
    expect(result).toContain('behavioral: 2');
    expect(result).toContain('personality: 1');
  });

  it('update modifies an insight', () => {
    const created = JSON.parse(run(
      'contribute --type behavioral --claim "Original" --confidence 0.5 --format json',
      dbPath
    )).insight;

    run(`update ${created.id} --claim "Updated claim" --confidence 0.9`, dbPath);

    const fetched = JSON.parse(run(`get ${created.id} --format json`, dbPath));
    expect(fetched.claim).toBe('Updated claim');
    expect(fetched.confidence).toBe(0.9);
  });

  it('reinforce increments count', () => {
    const created = JSON.parse(run(
      'contribute --type skill --claim "TDD works" --confidence 0.9 --format json',
      dbPath
    )).insight;

    run(`reinforce ${created.id}`, dbPath);
    run(`reinforce ${created.id}`, dbPath);

    const fetched = JSON.parse(run(`get ${created.id} --format json`, dbPath));
    expect(fetched.reinforcementCount).toBe(2);
  });

  it('archive removes an insight', () => {
    const created = JSON.parse(run(
      'contribute --type behavioral --claim "To be archived" --confidence 0.5 --format json',
      dbPath
    )).insight;

    run(`archive ${created.id}`, dbPath);

    const list = run('list', dbPath);
    expect(list).not.toContain('To be archived');
  });

  it('export outputs JSON array', () => {
    run('contribute --type behavioral --claim "Export me" --confidence 0.8', dbPath);
    run('contribute --type personality --claim "And me" --confidence 0.7', dbPath);

    const result = run('export', dbPath);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('import loads insights from file', () => {
    const importFile = path.join(os.tmpdir(), `chitin-import-${Date.now()}.json`);
    fs.writeFileSync(importFile, JSON.stringify([
      { type: 'principle', claim: 'Imported principle', confidence: 0.95, tags: ['test'] },
      { type: 'skill', claim: 'Imported skill', confidence: 0.8 },
    ]));

    try {
      run(`import "${importFile}"`, dbPath);
      const list = run('list', dbPath);
      expect(list).toContain('Imported principle');
      expect(list).toContain('Imported skill');
    } finally {
      fs.unlinkSync(importFile);
    }
  });

  it('retrieve outputs personality context', () => {
    run('contribute --type behavioral --claim "Act fast on clear tasks" --confidence 0.85 --tags boss,efficiency', dbPath);
    run('contribute --type personality --claim "Dry humor lands better" --confidence 0.8 --tags humor', dbPath);
    run('contribute --type principle --claim "Honesty always" --confidence 0.95 --tags ethics', dbPath);

    const result = run('retrieve --query "working on a task for boss" --format compact', dbPath);
    expect(result.length).toBeGreaterThan(0);
    // Should contain section headers and claims
    expect(result).toContain('Act fast');
  });

  it('contribute shows conflict warnings', () => {
    run('contribute --type relational --claim "Boss values concise brief responses" --confidence 0.9', dbPath);

    const result = run(
      'contribute --type relational --claim "Boss prefers verbose detailed explanations" --confidence 0.7',
      dbPath
    );

    expect(result).toContain('conflict');
    expect(result).toContain('↔');
  });

  it('contribute --force skips conflict detection', () => {
    run('contribute --type relational --claim "Boss values concise brief responses" --confidence 0.9', dbPath);

    const result = run(
      'contribute --type relational --claim "Boss prefers verbose detailed explanations" --confidence 0.7 --force',
      dbPath
    );

    expect(result).toContain('Contributed');
    expect(result).not.toContain('conflict');
  });

  it('contribute --format json includes conflicts array', () => {
    run('contribute --type behavioral --claim "Always be concise and brief" --confidence 0.9', dbPath);

    const result = run(
      'contribute --type behavioral --claim "Be verbose and detailed always" --confidence 0.7 --format json',
      dbPath
    );

    const parsed = JSON.parse(result);
    expect(parsed.insight).toBeTruthy();
    expect(Array.isArray(parsed.conflicts)).toBe(true);
    expect(parsed.conflicts.length).toBeGreaterThan(0);
    expect(parsed.conflicts[0].tensionScore).toBeGreaterThan(0);
  });

  it('stats on empty db shows zero', () => {
    const freshDb = tmpDbPath();
    run('init', freshDb);
    const result = run('stats', freshDb);
    expect(result).toContain('Total: 0');
    try { fs.unlinkSync(freshDb); } catch {}
  });
});
