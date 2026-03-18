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

  describe('provenance', () => {
    it('contribute with --provenance stores the value', () => {
      const result = run(
        'contribute --type skill --claim "Learned from directive" --confidence 0.9 --provenance directive --format json',
        dbPath
      );
      const parsed = JSON.parse(result);
      expect(parsed.insight.provenance).toBe('directive');

      // Verify via get
      const fetched = JSON.parse(run(`get ${parsed.insight.id} --format json`, dbPath));
      expect(fetched.provenance).toBe('directive');
    });

    it('contribute with each valid provenance type succeeds', () => {
      const types = ['directive', 'observation', 'social', 'correction', 'reflection', 'external'];
      for (const prov of types) {
        const result = run(
          `contribute --type skill --claim "Claim with ${prov}" --confidence 0.8 --provenance ${prov} --format json`,
          dbPath
        );
        const parsed = JSON.parse(result);
        expect(parsed.insight.provenance).toBe(prov);
      }
    });

    it('contribute with invalid --provenance value is rejected', () => {
      try {
        run(
          'contribute --type skill --claim "Bad provenance" --confidence 0.8 --provenance nonsense',
          dbPath
        );
        // Should not reach here
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e.stderr || e.message).toContain('Invalid provenance');
      }
    });

    it('contribute without --provenance has no provenance (backward compat)', () => {
      const result = run(
        'contribute --type behavioral --claim "No provenance" --confidence 0.8 --format json',
        dbPath
      );
      const parsed = JSON.parse(result);
      expect(parsed.insight.provenance).toBeUndefined();
    });

    it('list with --provenance filter returns only matching entries', () => {
      run('contribute --type skill --claim "Social claim" --confidence 0.8 --provenance social', dbPath);
      run('contribute --type skill --claim "Directive claim" --confidence 0.9 --provenance directive', dbPath);
      run('contribute --type skill --claim "No provenance claim" --confidence 0.7', dbPath);

      const socialList = run('list --provenance social', dbPath);
      expect(socialList).toContain('Social claim');
      expect(socialList).not.toContain('Directive claim');
      expect(socialList).not.toContain('No provenance claim');
      expect(socialList).toContain('1 insight(s)');
    });

    it('list shows provenance label in human output', () => {
      run('contribute --type skill --claim "Observable pattern" --confidence 0.8 --provenance observation', dbPath);

      const result = run('list', dbPath);
      expect(result).toContain('provenance: observation');
    });

    it('get shows provenance in human output', () => {
      const created = JSON.parse(run(
        'contribute --type skill --claim "Reflection insight" --confidence 0.8 --provenance reflection --format json',
        dbPath
      )).insight;

      const result = run(`get ${created.id}`, dbPath);
      expect(result).toContain('Provenance: reflection');
    });

    it('update with --provenance changes the value', () => {
      const created = JSON.parse(run(
        'contribute --type skill --claim "Mutable provenance" --confidence 0.8 --provenance social --format json',
        dbPath
      )).insight;

      run(`update ${created.id} --provenance directive`, dbPath);

      const fetched = JSON.parse(run(`get ${created.id} --format json`, dbPath));
      expect(fetched.provenance).toBe('directive');
    });
  });

  describe('reinforce with source tracking', () => {
    it('reinforce with --source and --evidence succeeds', () => {
      const created = JSON.parse(run(
        'contribute --type skill --claim "TDD works" --confidence 0.9 --format json',
        dbPath
      )).insight;

      const result = run(
        `reinforce ${created.id} --source "Bug #123 confirmed this" --evidence external`,
        dbPath
      );

      expect(result).toContain('Reinforced');
      expect(result).toContain('Source: Bug #123 confirmed this');
      expect(result).toContain('Evidence: external');
    });

    it('reinforce with --source only succeeds', () => {
      const created = JSON.parse(run(
        'contribute --type skill --claim "Pattern holds" --confidence 0.8 --format json',
        dbPath
      )).insight;

      const result = run(
        `reinforce ${created.id} --source "Noticed it again today"`,
        dbPath
      );

      expect(result).toContain('Reinforced');
      expect(result).toContain('Source: Noticed it again today');
    });

    it('reinforce without source/evidence still works', () => {
      const created = JSON.parse(run(
        'contribute --type skill --claim "Still true" --confidence 0.8 --format json',
        dbPath
      )).insight;

      const result = run(`reinforce ${created.id}`, dbPath);
      expect(result).toContain('Reinforced');
      expect(result).not.toContain('Source:');
    });
  });
});
