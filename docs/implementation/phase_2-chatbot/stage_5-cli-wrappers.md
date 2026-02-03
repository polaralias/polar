# Phase 2 - Stage 5: CLI Wrappers

## Goal
Enable safe integration with local tools (git, Apple Notes) via **CLI Wrappers**. These are typed connectors, **NOT** open shells.

## 1. CLI Connector
Build a `CLIConnector` in the Gateway.

*   **Configuration**:
    *   `executable_path`: Absolute path to binary (Allowlisted).
    *   `work_dir`: Allowed working directory.
    *   `env`: Allowlisted environment variables only.
*   **Tools**:
    *   `cli.run(args)`: Executes the binary.

## 2. Security Enforcements
*   **Executable Allowlist**: Only specific binaries (e.g., `/usr/bin/git`) can be run.
*   **Subcommand Allowlist**: Strict regex/list of allowed first arguments (e.g., `status`, `log`).
*   **Argument Schema**:
    *   **No Shell Injection**: Arguments must be passed as an array to `spawn`, never a string to `exec`.
    *   **No Globbing**: Handled by the wrapper or rejected.
    *   **No Pipes/Redirects**: `|`, `>`, `<` are strictly forbidden.
*   **Timeouts & Caps**:
    *   Kill process after N seconds.
    *   Cap output at M bytes (e.g., 100KB head/tail).

## 3. Output Handling
*   **JSON Mode**: Prefer CLIs that output JSON (parse and validate schema).
*   **Truncation**: If output exceeds cap, truncate middle and warn.
*   **Metadata**: Return execution duration and exit code.

## 4. Example Integrations
### Local Git
*   **Allowed**: `git status`, `git log`, `git diff` (read-only).
*   **Blocked**: `git push`, `git commit` (unless specifically enabled).

### Apple Notes (via AppleScript/CLI)
*   **Wrapper**: A small script that exposes specific functions (search, read).
*   **Constraint**: Can only read notes in specific folders.

## Acceptance Criteria
- [ ] `cli.run` tool refuses to run arbitrary binaries.
- [ ] Allowlisted commands execute and return output.
- [ ] Attempting to pass pipe characters or shell metacharacters fails.
- [ ] Long running commands are killed (timeout).
- [ ] Output is capped and truncated purely.
- [ ] Audit log records the exact command array.
