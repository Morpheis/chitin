---
name: chitin
description: "Personality persistence layer — injects structured behavioral insights into sessions and queues reflection on session transitions"
metadata:
  {
    "openclaw":
      {
        "emoji": "🦞",
        "events": ["agent:bootstrap", "command:new", "command:reset"],
      },
    "clawdbot":
      {
        "emoji": "🦞",
        "events": ["agent:bootstrap", "command:new", "command:reset"],
      },
  }
---

# Chitin Hook

## Bootstrap (agent:bootstrap)
Injects personality context from the Chitin insight store into every session.
Runs `chitin retrieve` with session context, adds output as synthetic `PERSONALITY.md`.

## Session Reset (command:new, command:reset)
Queues a personality reflection marker so the next heartbeat knows to
extract and persist new insights learned during the ended session.
