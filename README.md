# Foreman OpenCode Plugin

Foreman automates the BMAD implement-review-arbitrate loop by orchestrating separate LLM sessions for Developer, Reviewer, and Arbiter roles. Given a story ID, it creates isolated sessions for each role, transitions through a state machine (Idle -> Developing -> Reviewing -> Arbitrating -> Complete), and repeats the cycle if the Arbiter says NEEDS_WORK -- up to a configurable maximum number of iterations. The story file is the sole state carrier; Foreman reads it but never writes to it directly.

## Installation

Foreman is an OpenCode plugin distributed as an npm package. Add it to your `opencode.json`:

```json
{
  "plugin": ["foreman-opencode-plugin"]
}
```

If installed locally (not from npm), use the path form:

```json
{
  "plugin": ["/path/to/foreman-opencode-plugin"]
}
```

## Configuration

Copy the example config and edit as needed:

```bash
mkdir -p ~/.config/opencode
cp foreman.example.yaml ~/.config/opencode/foreman.yaml
```

Full schema:

```yaml
stories_dir: docs/stories
sprint_status: docs/sprint-status.yaml
max_iterations: 3

contexts:
  - docs/epics.md
  - docs/architecture.md

roles:
  developer:
    model: anthropic/claude-sonnet-4-20250514
    agent: sisyphus
  reviewer:
    model: anthropic/claude-sonnet-4-20250514
    agent: sisyphus
  arbiter:
    model: anthropic/claude-opus-4-20250514
    agent: sisyphus

role_timeout_ms: 1800000
```

| Field | Description |
|-------|-------------|
| `stories_dir` | Directory containing BMAD story files |
| `sprint_status` | Path to sprint-status.yaml |
| `max_iterations` | Max dev-review-arbitrate cycles before stopping (default: 3) |
| `contexts` | Files the arbiter reads for project awareness |
| `roles.*.model` | LLM model in `provider/model` format (e.g., `anthropic/claude-sonnet-4-20250514`) |
| `roles.*.agent` | OpenCode agent name for each role |
| `role_timeout_ms` | Timeout per role session in ms (default: 1800000 / 30 min) |

### Config Resolution Order

Foreman loads config from multiple locations (later overrides earlier):

1. **Built-in defaults** — sensible values for all fields
2. **User config** — `~/.config/opencode/foreman.{yaml,yml,json}`
3. **Project config** — `{project}/.opencode/foreman.*` or `{project}/.claude/foreman.*`

Project-level config is checked in `.opencode/` first, then `.claude/`. Values from project config are deep-merged over user config (nested objects like `roles` merge per-key; arrays and primitives replace entirely).

All relative paths (`stories_dir`, `sprint_status`, `contexts`) are resolved relative to the project directory where OpenCode is started, regardless of which config file defines them.

## Usage

Foreman registers two tools in OpenCode:

### foreman_run

Runs the full develop-review-arbitrate loop for a story.

```
foreman_run { "story_id": "1-3" }
```

This will:
1. Resolve the story file from `stories_dir` matching the ID pattern
2. Create a Developer session that runs `/bmad:bmm:dev-story`
3. Create a Reviewer session that runs `/bmad:bmm:code-review`
4. Create an Arbiter session that reads the story and renders a PASS or NEEDS_WORK verdict
5. If NEEDS_WORK, loop back to step 2 (up to `max_iterations` times)
6. Return a completion message

### foreman_status

Shows the current state of the active Foreman run.

```
foreman_status
```

Returns the current state (Idle, Developing, Reviewing, Arbitrating, Complete, Failed), the active story ID, and the current iteration number.

## Requirements

- [OpenCode](https://github.com/anomalyco/opencode) with plugin support
- [BMAD plugin](https://github.com/anomalyco/opencode) providing `/bmad:bmm:dev-story` and `/bmad:bmm:code-review` commands
- BMAD story files in the configured `stories_dir`

## Verifying It Works

### Smoke test (no BMAD needed)

After adding the plugin to `opencode.json` and starting OpenCode, call `foreman_status`. It should return:

```
State: Idle | Story: none | Iteration: 1/3
```

Then try `foreman_run` with any story ID. Without a matching story file it will fail, but the error message confirms the plugin is wired up correctly.

### Full test (requires BMAD)

You need a project with BMAD story files in the configured `stories_dir` and the BMAD plugin installed. Then in OpenCode:

```
foreman_run { "story_id": "1-3" }
```

This creates separate LLM sessions for Developer, Reviewer, and Arbiter, looping until PASS or max iterations.

Note: there is no standalone CLI mode. The plugin requires OpenCode's SDK for session creation and event handling.

## Development

```bash
# Install dependencies
bun install

# Run tests (123 tests across 8 files)
bun run test

# Type check
bun run typecheck

# Build
bun run build
```
