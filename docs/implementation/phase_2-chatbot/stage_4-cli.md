# Phase D: CLI Wrappers (Local Tools)

## Goal
Enable access to local tools and OS-native apps (Notes, git, system) safely. CLI wrappers are a "last resort" when no API exists, and must be treated as strict connectors.

## 1. When to use CLI Wrappers
**Allowed:**
*   OS-native apps without stable APIs (Notes, Reminders).
*   Mature CLIs with stable output (git, gh).
*   Local-only integrations.

**Disallowed:**
*   Free-form shell access.
*   Arbitrary package installers.
*   Interactive CLIs without controlled channels.

## 2. CLI Connector Design
Implement a **CLI Connector** behind the gateway.

### The `cli.exec` Tool Constraints
*   **Allowlisted Executables**: Only specific binaries.
*   **Allowlisted Subcommands**: precise command structures.
*   **Argument Validation**: Strict schema for args.
*   **Working Directory**: Restricted.
*   **Env Vars**: Allowlist only.
*   **Timeouts & Caps**: Execution limits and output size caps.
*   **No Network**: Unless explicitly allowed.

## 3. Output Handling
We must not let the model interpret unbounded raw output.
*   **JSON Mode**: Preferred (if CLI supports it).
*   **Strict Line Parsing**: If structure is known.
*   **Regex Extraction**: Explicit patterns stored in wrapper metadata.

## 4. Permissions Mapping
Granting a skill permission grants the CLI wrapper's **declared subset** of access.
*   Which executable?
*   Which commands?
*   Which file paths (read/write)?

## 5. Implementation Steps
1.  **CLI Connector**: Build the `cli.run` / `cli.exec` tool with the constraints above.
2.  **Wrapper Integration**: Add one local-only wrapper (e.g., **Notes Search** or **Git Status**).
3.  **Opt-in only**: Ship as opt-in initially.

## Acceptance Criteria
- [ ] CLI Connector accepts only allowlisted commands.
- [ ] Wrapper executes successfully and returns structured/parsed data.
- [ ] Attempting an arbitrary command (e.g., `rm -rf`, `curl`) is blocked.
- [ ] Output is truncated if it exceeds limits.
- [ ] Audit logs show the exact command line executed.
