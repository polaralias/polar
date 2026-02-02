# Polar Assistant: CLI Wrappers

CLI wrappers exist to cover integrations that lack stable APIs (especially OS-native apps) or where a mature CLI already exists. They are safe and reliable only when treated as **typed tools**, not free-form shell access.

## Goals
- Provide coverage without turning the platform into a shell
- Preserve least privilege and auditability
- Keep output bounded and parseable

## Principle
A CLI wrapper is implemented as a **CLI connector** behind the gateway:
- strict allowlists
- strict argument validation
- strict limits
- deterministic parsing
- no interactive prompts by default

## Wrapper metadata format
A wrapper is declared with:
- `id`
- `executable` (allowlisted)
- `allowed_subcommands` (allowlisted)
- `args_schema` per subcommand
- `working_dir_policy`
- `env_allowlist`
- `timeout_ms`
- `max_stdout_bytes`, `max_stderr_bytes`
- `output_format` (json | line | regex)
- `parsers` (if needed)

Skills that depend on wrappers reference them in the manifest and request the associated capabilities.

## CLI connector tool surface
Recommended tools:
- `cli.run` – runs a wrapper-defined command only
- `cli.check` – verifies executable exists and version matches constraints

Never expose a raw `shell.exec` tool.

## Security controls (mandatory)
- Executable allowlist
- Subcommand allowlist
- Argument validation (schema)
- No glob expansion by default
- No pipes, redirects, or shell metacharacters
- Read/write path restrictions (if wrapper touches the filesystem)
- Timeouts
- Output size caps
- Optional: network deny (enforced by deployment profile)

## Output handling
Preferred:
- JSON output mode from CLI (parse and validate)

If JSON is not possible:
- line-based outputs with explicit parsing rules
- regex extraction with bounded capture sizes

Never pass unlimited raw output to the model.

## Example: Apple Notes-style wrapper
Notes-like integrations often require macOS automation. Even then:
- keep the wrapper interface typed (search, create, list)
- filter fields and cap result counts
- treat note content as sensitive data; require explicit permission

## Auditing
Every CLI invocation must emit:
- wrapper id
- subcommand
- allowed/denied decision
- duration
- truncated output sizes (not full outputs by default)

## Testing requirements
- Attempt to call non-allowlisted executable is denied.
- Attempt to call non-allowlisted subcommand is denied.
- Invalid args are rejected before execution.
- Timeouts enforced.
- Output caps enforced.
