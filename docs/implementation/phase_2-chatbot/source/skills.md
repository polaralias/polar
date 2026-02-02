# Polar Assistant: Skills

Skills are **permission-bound feature packs** that expose one or more **worker templates**. A skill never holds credentials, never makes policy decisions, and never executes arbitrary code by default.

## Goals
- Provide assistant functionality as installable units with clear permissions
- Make execution reliable through **typed templates** rather than free-form instructions
- Keep enforcement in the runtime and gateway

## Definitions
- **Skill**: A package containing a manifest and one or more templates.
- **Template**: A declarative, typed execution plan (inputs/outputs + tool sequence) run by a constrained worker.
- **Capability**: A runtime-minted authorisation token enforced by the gateway.

## Skill package format (local-first)
A skill is distributed as a folder or zip:

- `polar.skill.json` (required) – manifest
- `templates/*.json` (required) – template definitions
- `prompts/*.md` (optional) – prompt fragments (no instructions that bypass templates)
- `ui/*.json` (optional) – UI metadata (labels, grouping, icons)
- `wrappers/*.json` (optional) – CLI wrapper metadata (if the skill relies on CLI tools)

### Manifest (`polar.skill.json`)
Required fields:
- `id` (string, globally unique)
- `name` (string)
- `version` (semver string)
- `description` (string)
- `templates` (array of template ids included in this skill)
- `requested_capabilities` (array of requested capability descriptors)
- `provenance` (optional) – signature/hash metadata

Rules:
- Unknown fields are rejected.
- Requested capabilities must be expressible in Polar’s policy model.
- The runtime always narrows requested scope to the intersection of **requested** and **granted**.

## Installation and lifecycle
1. **Install**: validate manifest and templates, register metadata, extract into skill store.
2. **Disabled**: installed skills are inert until permissions are granted.
3. **Grant**: user explicitly grants requested capabilities (all or subset).
4. **Enable**: skill can now run templates within granted scope.
5. **Upgrade**: compute diff vs current version.
   - If capabilities expand or widen: require re-consent.
   - If unchanged: allow fast update, still show “no permission changes”.
6. **Revoke/Disable/Uninstall**:
   - Revoke removes grants and invalidates future tool calls (see revocation design).
   - Disable blocks template execution without uninstalling.
   - Uninstall removes the skill package and its metadata.

## Template model
Each template is a JSON document with:
- `id`, `name`, `description`
- `input_schema` (JSON schema or Zod-serialised)
- `output_schema`
- `required_capabilities` (subset of the skill’s requested/granted capabilities)
- `steps` (ordered tool calls)
- `limits` (max results, time window, output size caps)

### Steps
A step must specify:
- `tool` (connector tool name)
- `args_schema`
- `arg_mapping` (how to map inputs + previous step outputs into tool args)
- `result_mapping` (how to map tool outputs into template output)

Rules:
- A template cannot call tools not registered in the gateway.
- A template cannot request capabilities outside its skill’s granted scope.
- A template must define caps/limits to bound cost and data exposure.

## Execution
Flow:
1. Main agent chooses a template and produces validated inputs.
2. Runtime authorises execution:
   - checks skill enabled
   - checks template exists
   - checks required caps ⊆ grants
3. Runtime spawns a **TemplateRunnerWorker** with:
   - template id
   - validated inputs
   - minted capability tokens (narrowed)
4. Worker executes the step sequence through the gateway.
5. Results return to the main agent for presentation.

## Consent for writes
Default pattern for write/delete:
- First run produces a **proposed action** (preview) when possible.
- User confirms.
- Runtime mints a short-lived write capability (minutes).
- Worker executes.

## Auditing
Audit events must exist for:
- install/upgrade/uninstall
- enable/disable
- permission grant/revoke
- template run start/finish
- every tool call (allowed and denied)

## Testing requirements
- Installing a malformed skill fails (schema validation).
- Template can only call tools within its declared steps.
- Grant narrowing works (template runs only within granted scope).
- Revocation blocks future calls (immediate for writes; per revocation mode for reads).
