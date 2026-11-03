#!/usr/bin/env python3
"""PreToolUse gate for AGENT tool calls (subagents / workflow agents).

Claude Code adds `agent_id` to hook input when a subagent makes the call;
the main, human-driven session has none, so this never blocks the user's
own approved actions. For agents it enforces the plan's hard gates in code
rather than in prompts -- an agent can't talk its way past an exit code:

  * no git push, no history-destroying git, no file deletion
  * no schema changes (drizzle-kit migrate/push/drop) or monthly import
  * no database access except through scripts/ops/agent-cli.ts
    (read-only SQL, the probe, allowlisted idempotent repairs, ledger rows)
  * no deploy / env / secret-store commands, no writes to the admin API
    other than via agent-cli's allowlist
  * no edits to .env files or to the gate configuration itself

Exit 2 blocks the call and shows the reason to the agent. Blocked attempts
are appended to .claude/agent-gate.log (gitignored) for the Agent Ops audit.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

if not data.get("agent_id"):
    sys.exit(0)  # main session: not gated here

tool = data.get("tool_name", "")
inp = data.get("tool_input", {}) or {}
project = os.environ.get("CLAUDE_PROJECT_DIR", data.get("cwd", "."))

BASH_RULES = [
    (r"\bgit\s+push\b", "git push is reserved for the user (approve it in chat)"),
    (r"\bgit\s+(reset\s+--hard|clean\b|checkout\s+--|restore\b|branch\s+-D|rebase\b|filter-branch)", "history/working-tree-destroying git commands are not allowed for agents"),
    (r"(^|[;&|]\s*|\s)(rm|rmdir|unlink|shred)\s", "deleting files needs the user's explicit approval"),
    (r"drizzle-kit\s+(migrate|push|drop|up)", "schema changes need the user's explicit approval"),
    (r"\bnpm\s+run\s+(-s\s+)?(import(?!:dry-run)|db:|backfill|sync-|refresh-|ops:probe)", "data-writing npm scripts are not allowed; use scripts/ops/agent-cli.ts"),
    (r"\b(psql|pg_dump|pg_restore|neonctl)\b", "direct database clients are not allowed; use agent-cli sql"),
    (r"\bvercel\s+(env|deploy|promote|rollback|remove|rm|domains|secrets|alias)\b", "deploy/env/secret-store commands are reserved for the user"),
    (r"\bcurl\b[^|;&]*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s|--form|-F\s)", "write requests are only allowed through agent-cli repair"),
    (r"/api/admin/", "the admin API is only reachable through agent-cli repair"),
    (r"[?&]refresh=1", "forced live-AUM recomputes write to the production DB"),
    (r"(>|>>|tee\s+)\s*\S*\.env", "writing .env files is not allowed"),
]

def block(reason: str) -> None:
    try:
        with open(os.path.join(project, ".claude", "agent-gate.log"), "a") as f:
            f.write(json.dumps({
                "at": datetime.now(timezone.utc).isoformat(),
                "agent_type": data.get("agent_type"),
                "tool": tool,
                "input": (inp.get("command") or inp.get("file_path") or "")[:500],
                "reason": reason,
            }) + "\n")
    except Exception:
        pass
    print(f"BLOCKED by agent gate (.claude/hooks/agent-gate.py): {reason}.", file=sys.stderr)
    sys.exit(2)

AGENT_CLI = re.compile(r"^\s*(npx\s+dotenv\s+-e\s+\.env\.local\s+--\s+npx\s+tsx\s+scripts/ops/agent-cli\.ts|npm\s+run\s+(-s\s+)?ops:agent)\b")

if tool == "Bash":
    cmd = inp.get("command", "")
    # Secrets: the only command allowed to load .env.local is the agent CLI
    # itself, and no command may carry a connection string or secret name.
    if re.search(r"postgres(ql)?://|neon\.tech|DATABASE_URL|ADMIN_SECRET|DHAN_|SETTINGS_ENCRYPTION_KEY|SUPABASE", cmd):
        block("commands may not reference database URLs or secrets")
    if re.search(r"\.env\b", cmd) and not AGENT_CLI.search(cmd):
        block("only scripts/ops/agent-cli.ts may load .env.local")
    for pattern, reason in BASH_RULES:
        if re.search(pattern, cmd):
            block(reason)
    # Running TypeScript/JS against the DB: only the agent CLI may do that.
    # (Type-checking, lint, build and tests don't go through tsx/node scripts.)
    for m in re.finditer(r"\b(tsx|ts-node|node)\s+(\S+)", cmd):
        target = m.group(2)
        if target.startswith("-"):
            continue
        if not target.endswith("scripts/ops/agent-cli.ts"):
            block(f"running {target} is not allowed; agents touch data only via scripts/ops/agent-cli.ts")
elif tool == "Read":
    if re.search(r"(^|/)\.env[^/]*$", (inp.get("file_path") or "").replace("\\", "/")) and not (inp.get("file_path") or "").endswith(".env.example"):
        block("reading .env files is not allowed")
elif tool in ("Edit", "Write", "NotebookEdit", "MultiEdit"):
    path = inp.get("file_path") or inp.get("notebook_path") or ""
    norm = path.replace("\\", "/")
    if re.search(r"(^|/)\.env[^/]*$", norm):
        block("editing .env files is not allowed")
    if re.search(r"(^|/)\.claude/(settings(\.local)?\.json|hooks/)", norm):
        block("agents may not modify their own gates or Claude settings")

sys.exit(0)
