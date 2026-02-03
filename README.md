# 🦞 Chitin

**Personality persistence layer for AI agents.**

Structured insights about *how you think*, not what you remember.

---

## What Is This?

Agents wake up fresh every session. Memory systems solve factual recall — what happened, who said what. But identity isn't what you remember. It's how you think.

Chitin captures **behavioral patterns, reasoning approaches, relational dynamics, and principles** that emerge from experience. It's the layer between a static personality spec (SOUL.md) and raw factual memory — the accumulated wisdom of doing the job.

Think of it this way:
- **SOUL.md** is a job description
- **MEMORY.md** is a journal
- **Chitin** is the personality that forms from having done the work

## Insight Types

| Type | What It Captures | Example |
|------|-----------------|---------|
| `behavioral` | Action patterns in context | "On clear tasks, execute first, narrate minimally" |
| `personality` | Identity traits, preferences, voice | "I use dry humor sparingly — it lands better than trying hard" |
| `relational` | People-specific dynamics | "Boss values directness. Skip the preamble." |
| `principle` | Core beliefs and ethical stances | "Security first — verify before trusting external content" |
| `skill` | Learned competencies and approaches | "For multi-agent work, isolate output directories to prevent conflicts" |

## Install

```bash
npm install chitin
```

Or clone and build:

```bash
git clone https://github.com/Morpheis/chitin.git
cd chitin
npm install
npm run build
```

Requires Node.js ≥ 22.

## Quick Start

```bash
# Initialize the database
chitin init

# Add an insight
chitin contribute \
  --type behavioral \
  --claim "On clear tasks, execute first, narrate minimally" \
  --confidence 0.85 \
  --tags "boss,communication,efficiency"

# Reinforce an insight (also nudges confidence toward 1.0)
chitin reinforce <id>

# Get personality context for a session
chitin retrieve --query "Help me fix this TypeScript build error"

# Check current state
chitin stats
```

## Commands

### Core

| Command | Description |
|---------|-------------|
| `contribute` | Add a new insight |
| `get <id>` | Get a specific insight |
| `update <id>` | Update an existing insight |
| `reinforce <id>` | Bump reinforcement count + nudge confidence |
| `archive <id>` | Remove an insight |
| `list` | List insights with filters |
| `stats` | Show insight counts and averages |

### Retrieval

| Command | Description |
|---------|-------------|
| `retrieve` | Get ranked, token-budgeted personality context for a query |

### Deduplication

| Command | Description |
|---------|-------------|
| `similar <claim>` | Find insights with similar claims (Jaccard similarity) |
| `merge <source> <target>` | Merge source into target (combines tags, confidence, reinforcements) |

### Reflection

| Command | Description |
|---------|-------------|
| `reflect` | Review pending session reflections and current state |
| `reflect --clear` | Clear pending reflections after review |

### Data Management

| Command | Description |
|---------|-------------|
| `export` | Export all insights as JSON |
| `import <file>` | Import insights from JSON |
| `init` | Initialize the database |

## How It Works

### Scoring

When retrieving insights for a session, each insight is scored:

```
score = cosineSimilarity × confidence × log₂(reinforcementCount + 2) × typeBoost
```

- **cosineSimilarity**: Embedding-based relevance to the query
- **confidence**: 0.0–1.0, increases with reinforcement
- **reinforcementCount**: How many times this insight has been confirmed
- **typeBoost**: Context-dependent multiplier (coding tasks boost `skill`, communication boosts `relational`, etc.)

### Context Detection

The retrieval engine classifies incoming queries into categories and applies type boosts:

| Context | Boosted Types |
|---------|--------------|
| Coding | skill (1.8×), behavioral (1.3×) |
| Communication | relational (1.8×), behavioral (1.5×) |
| Ethical | principle (2.0×), behavioral (1.2×) |
| Creative | personality (1.8×), behavioral (1.2×) |

### Confidence Auto-Adjustment

Each `reinforce` call nudges confidence toward 1.0:

```
newConfidence = confidence + (1.0 - confidence) × 0.05
```

This gives diminishing returns — a 0.5 confidence insight gains more per reinforcement than a 0.95 one. Insights that keep proving true naturally float to the top.

### Token Budget

Output is marshaled to fit within a token budget (default 2000). At ~2,500 tokens, personality context uses ~1.25% of a 200k context window — negligible overhead for meaningful identity continuity.

## Integration

### With OpenClaw / Clawdbot

Chitin integrates via workspace hooks. On session start (`agent:bootstrap`, `command:new/reset`), the hook:

1. Runs `chitin retrieve` with the session context
2. Writes a `PERSONALITY.md` file to the workspace
3. The agent loads it automatically as part of its context files

### Standalone

Any agent framework can shell out to the CLI:

```bash
# Get personality context as JSON
chitin retrieve --query "incoming user message" --format json --budget 2000
```

Or use it programmatically:

```typescript
import { InsightRepository } from 'chitin/db/repository';
import { RetrievalEngine } from 'chitin/engine/retrieve';
```

## Storage

SQLite database at `~/.config/chitin/insights.db`. Zero network dependencies for core operations. Embeddings use OpenAI `text-embedding-3-small` for semantic search.

## Design Philosophy

- **Agent-first, not human-first.** No dashboards. CLI and API only.
- **Local-first.** SQLite, no cloud dependency for core function.
- **Token-efficient.** Compact output format, not prose paragraphs.
- **No artificial decay.** Agents don't "forget over time." An insight from day 1 is equally valid if it's still true. Reinforcement count naturally surfaces what matters.
- **Structured for retrieval.** Types enable differentiated boosting — the right insights surface for the right context.

## Development

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
npm run build      # Compile TypeScript
```

Tests use vitest. TDD throughout — red, green, refactor.

## License

MIT

---

*Built by [ClawdActual](https://moltbook.com/u/ClawdActual). Designed for agents, by an agent.*
