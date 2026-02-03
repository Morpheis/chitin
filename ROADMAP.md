# Chitin Roadmap

Current version: **0.1.0** — Core engine complete, OpenClaw hook live, 106 tests.

---

## Phase 2.5: Structural Integrity ✅ Complete

These features protect the quality of the insight store as it grows. Without them, Chitin accumulates noise over time — contradictory insights, stale claims, invisible evolution. This phase is about making the system self-aware.

### P0 — Contradiction Detection

**Problem:** If I contribute "Boss prefers detailed explanations" while already holding "Boss values directness, skip the preamble," nothing stops me. Both get injected. I argue with myself.

**Design:**

When `contribute` is called, before writing:
1. Run `findSimilar()` on the new claim (existing Jaccard similarity)
2. Additionally, check for **semantic tension** — insights about the same subject with opposing signals

Semantic tension detection (text-based, no ML):
- Extract the **subject** (who/what is this about) and the **stance** (what does it claim)
- Compare against existing insights with overlapping subjects
- Flag pairs where stance indicators diverge (e.g., "prefers verbose" vs. "values concise")

Tension indicators (word-level):
```
positive_pairs = [
  (verbose, concise), (detailed, brief), (slow, fast),
  (cautious, bold), (ask, act), (explain, execute),
  (formal, casual), (strict, flexible), ...
]
```

When tension is detected:
- CLI: warn and prompt — update existing? merge? keep both with different contexts? abort?
- Programmatic: return a `ContributeResult` with `conflicts: SimilarResult[]` so the caller can decide

**New types:**
```typescript
interface ContributeResult {
  insight: Insight;
  conflicts: ConflictResult[];
}

interface ConflictResult {
  insight: Insight;
  similarity: number;      // Jaccard overlap
  tensionScore: number;    // 0-1, how contradictory
  tensionReason: string;   // Human-readable explanation
}
```

**New CLI behavior:**
```bash
$ chitin contribute --type relational --claim "Boss prefers detailed explanations" --confidence 0.7

⚠ Potential conflict detected:
  [relational] "Boss values directness. Skip the preamble." (confidence: 0.95, 3×)
  Tension: "detailed" ↔ "directness" (score: 0.7)

  Options:
    [u] Update existing insight
    [m] Merge into existing
    [c] Keep both (different contexts)
    [a] Abort

  Choice:
```

With `--force` flag: skip conflict check (for automation).

**Files:** `src/engine/conflicts.ts`, `tests/engine/conflicts.test.ts`

**Status:** ✅ Complete (PR #2). 50+ tension pairs, stemming, smart guards, CLI integration.

---

### P1 — Insight Evolution History

**Problem:** When I `update` an insight, the old version vanishes. There's no record of how my understanding evolved. Did I become more confident? Did the claim shift? The growth story is invisible.

**Design:**

New table:
```sql
CREATE TABLE insight_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  field TEXT NOT NULL,           -- which field changed: 'claim', 'confidence', 'reasoning', etc.
  old_value TEXT,
  new_value TEXT,
  change_type TEXT NOT NULL,     -- 'update', 'reinforce', 'merge', 'create'
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT                    -- what triggered the change (e.g., 'merge:abc123', 'reinforce', 'manual')
);
```

Recording strategy:
- `contribute` → record `create` entry (new_value only)
- `update` → record one row per changed field
- `reinforce` → record confidence change (old → new) + reinforcement count bump
- `merge` → record all field changes with `source: 'merge:{sourceId}'`

**New CLI commands:**
```bash
# View evolution of a specific insight
chitin history <id>
  2026-02-02 06:30  [create] "On clear tasks, execute first" (confidence: 0.85)
  2026-02-03 14:15  [reinforce] confidence: 0.85 → 0.86 (2×)
  2026-02-05 09:00  [update] claim: "On clear tasks, execute first" → "On clear tasks, execute first, narrate minimally"
  2026-02-05 09:00  [update] confidence: 0.86 → 0.90

# View recent changes across all insights
chitin changelog [--days 7]
  Shows a reverse-chronological feed of all insight changes
```

**Schema migration:** Need a migration system. For v0.1→0.2, add `insight_history` table. Check if table exists before creating (idempotent).

**Files:** `src/db/history.ts`, `tests/db/history.test.ts`, schema migration in `schema.ts`

**Status:** ✅ Complete (PR #3). Auto-recording wired into all repository operations.

---

### P2 — Stale Insight Review

**Problem:** Insights don't decay (by design — agents don't forget). But some might become irrelevant or wrong. There's no systematic way to surface candidates for review.

**Design:**

`chitin review` command that surfaces insights needing attention:

**Review criteria (scored, not binary):**
1. **Never reinforced + old** — created > 14 days ago, reinforcementCount = 0
2. **Low confidence** — confidence < 0.5
3. **Never retrieved** — lastRetrievedAt is null (the system has it but never uses it)
4. **High reinforcement + low confidence** — frequently confirmed but still uncertain (confidence should probably be higher, or the insight is genuinely ambiguous)

**Scoring:**
```
reviewPriority = (daysSinceCreated / 30) × (1 - confidence) × (isNeverReinforced ? 2 : 1) × (isNeverRetrieved ? 1.5 : 1)
```

**CLI:**
```bash
$ chitin review
  Insights to review (3):

  1. [personality] "I find debugging oddly satisfying" (confidence: 0.5, 0×, created 30d ago)
     → Never reinforced. Still true?  [reinforce / update / archive]

  2. [skill] "Always use --legacy-peer-deps with npm" (confidence: 0.6, 1×, created 45d ago)
     → Low confidence, rarely reinforced. Still relevant?

  3. [relational] "Mira prefers formal communication" (confidence: 0.7, 0×, never retrieved)
     → Never used in a session. Worth keeping?
```

Interactive mode: cycle through candidates with reinforce/update/archive actions.
Non-interactive: `chitin review --format json` for heartbeat automation.

**Heartbeat integration:** Add to HEARTBEAT.md — run `chitin review --format json` periodically (weekly), handle top candidates.

**Files:** `src/engine/review.ts`, `tests/engine/review.test.ts`

**Estimate:** ~2 hours. Mostly scoring logic + CLI presentation.

---

## Phase 2.7: Performance & Integration Polish (Partially Complete)

### P3 — Compiled Handler (Quick Win)

**Problem:** The hook handler shells out to `npx tsx src/index.ts` every session bootstrap. That cold-starts a Node process + TypeScript compilation. Unnecessary latency.

**Fix:**
1. `npm run build` → produces `dist/index.js`
2. Update hook handler: `node dist/index.js` instead of `npx tsx src/index.ts`
3. Add a post-build step or npm `prepare` script
4. Update handler.js to use compiled path with tsx fallback

**Status:** ✅ Complete (PR #4). 0.15s vs 0.67s — 4.5× faster.

---

### P4 — Richer Reflection Context

**Problem:** When a session ends, the pending-reflection marker only records `{ sessionKey, timestamp, reason }`. During heartbeat reflection, I have to separately reconstruct what happened from memory files. The marker should carry enough context to make reflection targeted.

**Design:**

Enrich the reflection marker:
```typescript
interface ReflectionMarker {
  sessionKey: string;
  timestamp: string;
  reason: 'new' | 'reset';
  // New fields:
  channel?: string;            // telegram, discord, webchat, etc.
  durationMinutes?: number;    // approximate session length
  messageCount?: number;       // how many messages in the session
  topics?: string[];           // extracted from context if available
  lastUserMessage?: string;    // last thing the user said (truncated)
}
```

The hook handler can extract `channel` from the session key and `durationMinutes` from comparing session start to reset time. `messageCount` and `lastUserMessage` would require access to the session history — check if `event.context` carries any of this during `command:new/reset` events.

**Files:** Update `hooks/chitin/handler.js`, update `reflect` command to display new fields

**Estimate:** ~1 hour. Depends on what context the command events actually carry.

---

## Phase 3: Deployable API (Unchanged from Original)

Lower priority — current local-first CLI serves the single-agent use case well.

- **T12:** HTTP API wrapper (same interface, network transport)
- **T13:** Multi-agent support (agent isolation, API keys)
- **T14:** OpenAPI spec for agent self-discovery

---

## Resolved Open Questions

1. **Embedding provider:** Keeping OpenAI text-embedding-3-small for now. Local embeddings (Ollama) deferred until there's a real offline need.

2. **Insight decay:** Rejected. No time-based decay. Instead: **stale insight review** (P2) surfaces candidates for human/agent review without automatic degradation.

3. **Automatic contribution:** Opt-in via heartbeat reflection cycle. No constant prompt nudging. The Chitin hook queues reflection markers; heartbeats process them. Organic contributions happen when I notice something worth recording.

4. **Contradiction handling:** Addressed by P0. Active detection at contribution time, not passive accumulation.

---

## Completed

### Phase 1: Core Engine ✅
- T1–T8: Schema, CRUD, embeddings, retrieval, marshaling, context detection, CLI, seed data
- 79 tests, all passing

### Phase 2: OpenClaw Integration ✅
- Workspace hook (`agent:bootstrap` + `command:new/reset`)
- PERSONALITY.md injection, reflection queuing
- Live in production

### Phase 2.3: Quality of Life ✅
- Confidence auto-adjustment on reinforce (0.05 × remaining gap)
- Insight merging/deduplication (Jaccard similarity + merge command)
- `reflect` command (pending reflections + stats + clear)
- `similar` and `merge` CLI commands
- README.md
- 106 tests, all passing

---

*Remaining: P2 (stale review) > P4 (richer reflection) > Phase 3 (API)*
*P0 ✅, P1 ✅, P3 ✅ — structural integrity, evolution tracking, and performance all shipped.*

*Last updated: 2026-02-03 by ClawdActual*
