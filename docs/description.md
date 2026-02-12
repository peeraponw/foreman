# Foreman

**An OpenCode plugin that automates the BMAD implement-review-arbitrate
development loop using multiple LLM sessions.**

Ships as a TypeScript plugin for [OpenCode](https://opencode.ai).
Runs on top of [Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)
(OMO) with the Sisyphus agent.

---

## The Problem

You use the BMAD method to produce detailed specifications: epics,
architecture documents, story files with acceptance criteria and
Gherkin-style scenarios. You have powerful coding agents
(OpenCode + Sisyphus). But the gap between "here is a spec" and
"here is working software" is still manual:

1. You run `/bmad:bmm:dev-story` to implement a story.
2. You run `/bmad:bmm:code-review` to review it.
3. The reviewer finds issues and writes action items to the story file.
4. You run `/bmad:bmm:dev-story` again to fix them.
5. You review again. You fix again. You review again.

Each step requires you to invoke the command, wait for it to finish,
read the story file, decide what to do next, and invoke the next
command. It is a mechanical loop that a machine should run.

Foreman runs the loop.

---

## How It Works

Foreman is an OpenCode plugin that registers a `/foreman run` tool.
When invoked, it reads a BMAD story file, creates OpenCode sessions
for each role (developer, reviewer, arbiter), and drives the state
machine to completion.

### The Loop

```
Idle --> Developing --> Reviewing --> Arbitrating --> Complete
             ^                            |
             |                            |
             +-------- needs_work --------+
```

Each arrow is a session transition. Each session is an independent
OpenCode session with its own context window.

### Roles

**Developer** reads the story file and runs `/bmad:bmm:dev-story`.
It implements the acceptance criteria, writes code, and updates the
story file with its progress. If review action items exist from a
previous iteration, it addresses those.

**Reviewer** reads the story file and runs `/bmad:bmm:code-review`.
It verifies the implementation against the acceptance criteria. If it
finds issues, it writes action items to the story file. If everything
looks good, it approves.

**Arbiter** reads the story file along with broader project context
(epics, architecture, other relevant documents). It does not run BMAD
commands. It judges: does the implementation satisfy the acceptance
criteria? Are review action items resolved? It responds with PASS or
NEEDS_WORK.

If the arbiter says NEEDS_WORK, Foreman loops back to Developing.
The developer session picks up the remaining action items
automatically because `/bmad:bmm:dev-story` detects them in the
story file.

If the arbiter says PASS, the story is complete.

### Why Three Roles

The reviewer will always find something. That is its job. The arbiter
exists to answer a different question: "Is this done, given the
acceptance criteria and the project context?" This mirrors real teams
where a tech lead triages review findings and decides which ones
actually block shipping.

### Context Isolation

Each role runs in a separate OpenCode session. The developer cannot
influence what the reviewer sees. The reviewer cannot influence what
the arbiter evaluates. The story file is the sole communication
medium between them. This is a structural guarantee against agents
rubber-stamping their own work.

### Different LLMs Per Role

Each role can use a different LLM. The OpenCode SDK supports
specifying `model` and `agent` per prompt. Foreman maps role
configuration to SDK calls:

```
Developer  -> session.promptAsync({ model: { providerID, modelID }, ... })
Reviewer   -> session.promptAsync({ model: { providerID, modelID }, ... })
Arbiter    -> session.promptAsync({ model: { providerID, modelID }, ... })
```

You can assign a fast model to development, a thorough model to
review, and a reasoning model to arbitration.

---

## BMAD Integration

Foreman extends the [BMAD method](https://github.com/bmad-method)
workflow system. BMAD provides:

- **Story files**: Markdown files with status, acceptance criteria
  (Gherkin), tasks/subtasks (checkboxes), dev records, and change logs.
- **Workflow commands**: `/bmad:bmm:dev-story` and
  `/bmad:bmm:code-review` that guide the LLM through structured
  implementation and review processes.
- **Sprint tracking**: `sprint-status.yaml` for progress across stories.

### Interactive Prompt Handling

BMAD workflows use `<ask>` XML tags that pause for user input
(confirmations, option selection). Since Foreman runs sessions
without a human present, it wraps BMAD commands in composite prompts
that instruct the LLM to answer interactive questions itself:

```
Run /bmad:bmm:code-review {story_file_path}

The workflow will ask interactive questions.
- First confirmation: answer "y"
- Second confirmation: answer "y"
- When asked to select action: answer "2" (create action items)
Do not wait for user input.
```

If this proves unreliable for certain workflows, alternative
strategies (such as intercepting prompts at the SDK level) can be
explored.

### Story File as State

Foreman derives its state from the story file content. No separate
persistence is needed. On restart (e.g., after an OpenCode crash),
`/foreman run` re-reads the story file and resumes from the correct
state:

| `Status:` field   | Review section exists? | Foreman state       |
|--------------------|------------------------|---------------------|
| `ready-for-dev`    | No                     | Idle                |
| `in-progress`      | No                     | Developing          |
| `review`           | No                     | Ready for review    |
| `in-progress`      | Yes                    | Developing (fixing) |
| `done`             | Yes (all resolved)     | Complete            |

The `Status:` field, the presence of a "Senior Developer Review (AI)"
section, and the state of task checkboxes uniquely determine where
the loop is.

**Note on rubber-stamping:** Sometimes the developer or reviewer
sets the story status to `done` prematurely, declaring its own work
complete without proper verification. Foreman does not trust the
status field alone. The arbiter always runs regardless of what status
the developer or reviewer wrote. Only the arbiter's PASS verdict
causes Foreman to treat a story as complete.

---

## Architecture

### Plugin Structure

Foreman is an OpenCode plugin, distributed as an npm package and
loaded via `opencode.json`:

```json
{
  "plugin": ["oh-my-opencode", "foreman-opencode-plugin"]
}
```

### File Layout

```
foreman-opencode-plugin/
  package.json
  tsconfig.json
  src/
    index.ts            Plugin entry: tool registration, event handler
    foreman.ts          Orchestrator: state machine, session tracking
    prompts/
      developer.ts      Composite prompt builder for dev sessions
      reviewer.ts       Composite prompt builder for review sessions
      arbiter.ts        Prompt builder for arbiter sessions
    story-parser.ts     Story file reader, state derivation
    config.ts           Config schema (Zod validation)
    types.ts            Shared types
```

### Session Orchestration

The plugin uses the OpenCode SDK to manage sessions:

1. **Create session**: `client.session.create()` with a descriptive
   title per role.
2. **Send prompt**: `client.session.promptAsync()` with role-specific
   `model`, `agent`, and composite prompt text. The story file path
   is always included (not just the story number) because some LLMs
   ask for it.
3. **Detect completion**: Listen for `session.idle` events, validated
   by checking that `message.updated` with `role === "assistant"` has
   fired (prevents false positives from premature idle).
4. **Transition state**: Read the story file, determine next state,
   create the next session.

Each state transition creates a new session. Sessions do not share
context. The story file carries all information between roles.

### Event Handling

The plugin registers a global event listener at startup:

- `session.idle` + work validation -> trigger next state transition
- `session.error` -> handle failure, notify user
- `message.updated` -> track that the agent produced output

### Safety

- **Max iterations**: Configurable limit (default 3) prevents
  infinite loops. After N dev-review-arbitrate cycles, Foreman stops
  and notifies the user.
- **Iteration context**: The arbiter prompt includes the current
  iteration number, so it can factor in diminishing returns.

---

## Configuration

Plugin config lives at `~/.config/opencode/foreman.json`:

```json
{
  "stories_dir": "docs/stories",
  "sprint_status": "docs/sprint-status.yaml",
  "max_iterations": 3,
  "contexts": [
    "docs/epics.md",
    "docs/architecture.md"
  ],
  "roles": {
    "developer": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "agent": "sisyphus"
    },
    "reviewer": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "agent": "sisyphus"
    },
    "arbiter": {
      "provider": "anthropic",
      "model": "claude-opus-4-20250514",
      "agent": "sisyphus"
    }
  }
}
```

| Field             | Purpose                                        |
|-------------------|------------------------------------------------|
| `stories_dir`     | Directory containing BMAD story files          |
| `sprint_status`   | Path to sprint-status.yaml                     |
| `max_iterations`  | Max dev-review-arbitrate cycles before stopping |
| `contexts`        | Files the arbiter reads for project awareness  |
| `roles.*.provider`| LLM provider ID for each role                 |
| `roles.*.model`   | LLM model ID for each role                    |
| `roles.*.agent`   | OpenCode agent name for each role              |

---

## Usage

```
/foreman run <story-id>       Full loop until complete or max iterations
/foreman status               Show current state for the active story
```

Example:

```
/foreman run 1-3
```

Foreman resolves the story ID to a file path by scanning
`stories_dir` for a file matching the pattern `1-3-*.md` (e.g.,
`docs/stories/1-3-user-authentication.md`). It then reads the story,
starts the developer session, waits for completion, starts the
reviewer, waits, runs the arbiter, and either loops or declares the
story complete. Progress is visible via `/foreman status` or through
OpenCode's session list.

---

## Future Directions

These capabilities are designed for but not implemented in v1:

- **Arbiter reformat the story file**: The reviewer/developer does not always follow the given story file format when writing, but rather their own style. The arbiter reformat the file to make it more human-readable when audit
- **Arbiter shard the story file**: Sometimes the back-and-forth fighting between developer/reviewer takes long and the story file becomes enermous. The arbiter should be able to archive tasks/topics that are resolved or become lower-priority given the current developer/reviewer state. 
- **Sprint planning**: Arbiter reads the epic file and creates a
  sprint plan with prioritized stories.
- **Epic-level review**: After all stories in an epic are complete,
  the arbiter reviews the full implementation against epic-level
  acceptance criteria.
- **Learning accumulation**: The arbiter accumulates patterns and
  learnings from completed stories to improve future iterations.
- **Documentation updates**: Automated documentation generation
  based on implemented stories.
- **Wave parallelism**: Run independent stories in parallel across
  multiple sessions. The architecture supports this (separate
  sessions, story-file-per-story isolation) but it requires careful
  handling of shared resources like sprint-status.yaml.

---

## Design Decisions

**Why a plugin, not a standalone binary?**
The OpenCode SDK provides session creation, prompt delivery, and
event-based completion detection out of the box. A standalone binary
would need to spawn `opencode run` processes, manage their lifecycle,
parse stdout, and handle PTY interaction for interactive prompts. The
plugin avoids all of that by using the SDK directly. It also loads
automatically when OpenCode starts.

**Why separate sessions per role?**
Context isolation. The developer session accumulates implementation
context (file contents, tool calls, error messages). The reviewer
should evaluate the output, not the process. A fresh session ensures
the reviewer reads the code and story file without being influenced
by the developer's reasoning. Same principle applies to the arbiter.

**Why an arbiter instead of hard convergence criteria?**
A rule like "zero review issues" never triggers because reviewers
always find something. A rule like "fewer than 3 issues" is arbitrary.
The arbiter applies judgment: it reads the acceptance criteria, reads
the review findings, and decides whether the implementation is
sufficient. This is the same pattern real teams use.

**Why derive state from the story file?**
The story file is already the single source of truth in the BMAD
workflow. Dev-story writes status changes, code-review writes action
items. Rather than maintaining a separate state file that can drift
out of sync, Foreman reads the story file and infers its state. This
also means restart recovery is free: re-read the file, pick up where
you left off.

**Why include file paths in prompts?**
Some LLMs, when given only a story number like `1.3`, ask "where is
the story file located?" before proceeding. Including the full path
in the composite prompt eliminates this unnecessary back-and-forth.
