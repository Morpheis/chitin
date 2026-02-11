/**
 * Chitin — Personality persistence hook for OpenClaw
 * 
 * Two responsibilities:
 * 1. On agent:bootstrap — inject personality context into sessions
 * 2. On command:new/reset — trigger reflection to capture new insights
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".config", "chitin", "insights.db");
const CHITIN_DIR = path.join(os.homedir(), "Personal", "chitin");
const CHITIN_DIST = path.join(CHITIN_DIR, "dist", "index.js");
const DEFAULT_BUDGET = 2000;
const DEBUG = !!process.env.CHITIN_DEBUG;

function log(...args) {
  if (DEBUG) console.error("[chitin]", ...args);
}

// ──────────────────────────────────────────────
// Bootstrap: inject personality context
// ──────────────────────────────────────────────

function handleBootstrap(event) {
  const context = event.context;
  if (!context?.bootstrapFiles || !Array.isArray(context.bootstrapFiles)) return;
  if (!fs.existsSync(DB_PATH)) return;

  const query = buildQueryFromContext(context, event.sessionKey || "unknown");
  if (!query) return;

  try {
    const result = runChitin(
      `retrieve --query "${escapeShell(query)}" --budget ${DEFAULT_BUDGET} --format compact`
    );

    if (!result || result.includes("No insights stored")) return;

    context.bootstrapFiles.push({
      name: "PERSONALITY.md",
      content: [
        "# Personality Context (Chitin)",
        "",
        "These are your learned behavioral patterns and insights.",
        "They persist across sessions. You can update them with `chitin contribute`.",
        "",
        result,
      ].join("\n"),
      missing: false,
      source: "chitin-hook",
    });

    log(`Injected personality context (${result.length} chars) for ${event.sessionKey}`);
  } catch (err) {
    log(`Bootstrap error: ${err.message || err}`);
  }
}

// ──────────────────────────────────────────────
// Session reset: trigger reflection
// ──────────────────────────────────────────────

function handleSessionReset(event) {
  // Push a reflection summary as a message that gets delivered before reset
  // This tells the user (and any observers) that insights were captured
  // The actual insight contribution happens via the reflection cron/heartbeat
  // because we don't have LLM access in hooks to extract insights intelligently.
  
  // What we CAN do: record that a session ended, so the next heartbeat
  // knows to do a reflection pass.
  try {
    const markerPath = path.join(os.homedir(), ".config", "chitin", "pending-reflection.json");
    const marker = {
      sessionKey: event.sessionKey || "unknown",
      timestamp: new Date().toISOString(),
      reason: event.action, // "new" or "reset"
    };

    // Append to pending reflections (array)
    let pending = [];
    if (fs.existsSync(markerPath)) {
      try {
        pending = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
        if (!Array.isArray(pending)) pending = [];
      } catch { pending = []; }
    }
    pending.push(marker);
    
    // Keep only last 10
    if (pending.length > 10) pending = pending.slice(-10);
    
    fs.writeFileSync(markerPath, JSON.stringify(pending, null, 2));
    log(`Queued reflection for session ${event.sessionKey} (${event.action})`);
  } catch (err) {
    log(`Reset handler error: ${err.message || err}`);
  }
}

// ──────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────

export default async function handler(event) {
  if (event.type === "agent" && event.action === "bootstrap") {
    handleBootstrap(event);
    return;
  }

  if (event.type === "command" && (event.action === "new" || event.action === "reset")) {
    handleSessionReset(event);
    return;
  }
}

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────

function runChitin(args) {
  // Use compiled dist if available (much faster than npx tsx)
  const useCompiled = fs.existsSync(CHITIN_DIST);
  const command = useCompiled
    ? `node "${CHITIN_DIST}" --db "${DB_PATH}" ${args}`
    : `npx tsx "${path.join(CHITIN_DIR, "src", "index.ts")}" --db "${DB_PATH}" ${args}`;

  log(`Running chitin via ${useCompiled ? "compiled dist" : "tsx fallback"}`);

  return execSync(command, {
    cwd: CHITIN_DIR,
    encoding: "utf-8",
    timeout: useCompiled ? 3000 : 5000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function buildQueryFromContext(context, sessionKey) {
  const parts = [];
  if (context.agentId) parts.push(`agent: ${context.agentId}`);

  if (sessionKey.includes("telegram")) parts.push("telegram chat");
  else if (sessionKey.includes("discord")) parts.push("discord group chat");
  else if (sessionKey.includes("slack")) parts.push("slack work chat");
  else if (sessionKey.includes("webchat")) parts.push("webchat direct conversation");
  else if (sessionKey.includes("subagent")) parts.push("sub-agent task execution");

  if (parts.length === 0) parts.push("general assistant session");
  return parts.join(", ");
}

function escapeShell(str) {
  return str.replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}
