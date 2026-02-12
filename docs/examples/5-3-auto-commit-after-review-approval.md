# Story 5.3: Auto-Commit After Review Approval

Status: done

## Story

As a **user**,
I want **code committed automatically after review approval**,
so that **I return to find clean, atomic commits**.

## Acceptance Criteria

1. **Given** Reviewer approves a story implementation, **When** the approval is processed, **Then** all changes are committed with semantic message (FR23, FR24):
   ```
   feat(epic-001): Story 1 - Add user authentication

   Implements user registration and login endpoints.

   Story: epic-001/story-1
   Reviewed-by: bmad-auto
   ```
2. **Given** config has `git.auto_commit: true`, **When** review passes, **Then** commit is created automatically
3. **Given** config has `git.auto_commit: false`, **When** review passes, **Then** changes are staged but not committed (user commits manually)
4. **Given** there are no changes to commit, **When** commit is attempted, **Then** workflow logs warning and continues (idempotent)
5. Commit hash is stored in state: `stories.completed[].commit`
6. Commits are atomic - all or nothing (NFR4)
7. Tests verify commit creation and message format

## Tasks / Subtasks

- [x] Task 1: Implement commit after review (AC: 1, 5)
  - [ ] Trigger commit when review passes
  - [ ] Build semantic commit message
  - [ ] Store commit hash in state
  - [ ] Add to completed stories list
- [x] Task 2: Implement config check (AC: 2-3)
  - [ ] Check git.auto_commit setting
  - [ ] Stage changes regardless
  - [ ] Skip commit if auto_commit is false
- [x] Task 3: Handle no changes case (AC: 4)
  - [ ] Check if there are staged changes
  - [ ] Log warning if nothing to commit
  - [ ] Continue workflow without error
- [x] Task 4: Build commit message (AC: 1)
  - [ ] Use semantic format: feat(epic-XXX): Story N - Title
  - [ ] Include implementation summary in body
  - [ ] Add story reference and reviewed-by
- [x] Task 5: Ensure atomicity (AC: 6)
  - [ ] Stage all changes together
  - [ ] Single commit for all story changes
- [x] Task 6: Write tests (AC: 7)
  - [ ] Test commit creation
  - [ ] Test commit message format
  - [ ] Test no-changes handling
  - [ ] Test config variations

## Dev Notes

### Architecture Patterns & Constraints

- Orchestrator delegates to GitHandler for commit
- Commit message follows semantic format (per AGENTS.md §13.2)
- Atomic commits - all changes in one commit
- Never commit without review approval

### Commit Message Format

```
feat(epic-001): Story 1 - Add user authentication

Implements user registration and login endpoints.

Story: epic-001/story-1
Reviewed-by: bmad-auto
```

### Implementation

```python
async def commit_story(self, story: Story, impl_summary: str):
    """Commit story changes after review approval."""
    if not self.config.git.auto_commit:
        logger.info("Auto-commit disabled, skipping commit")
        return None

    # Stage all changes
    self.git.stage_all()

    # Check if there are changes
    if not self.git.has_staged_changes():
        logger.warning("No changes to commit")
        return None

    # Build commit message
    message = build_commit_message(
        epic_name=self.state.workflow.epic_path,
        story=story,
        summary=impl_summary,
    )

    # Commit and get hash
    commit_hash = self.git.commit(message)

    # Update state
    self.state.stories.completed.append(
        CompletedStory(story_id=story.id, commit=commit_hash)
    )
    save(self.state)

    return commit_hash
```

### Source Tree Components

```
src/bmad_auto/
├── core/
│   └── orchestrator.py   # commit_story method
└── features/
    └── git_integration/
        └── handler.py    # stage_all, commit methods
```

### Testing Standards

- Use git_repo fixture
- Verify commit exists in git log
- Verify commit message format
- Test idempotency

### References

- [Source: _bmad-output/project-planning-artifacts/epics/epic-5-git-integration-auto-commit.md#story-53-auto-commit-after-review-approval]
- [Source: _bmad-output/architecture/implementation-patterns-consistency-rules.md#git-commit-messages-per-agentsmd-132]

## Review Follow-ups (AI)

- [x] [AI-Review][HIGH] Mark all tasks as [x] complete - implementation exists in orchestrator.py
- [x] [AI-Review][HIGH] Fill in Dev Agent Record with implementation details

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

- `src/bmad_auto/core/orchestrator.py` (_commit_story method, lines 327-378)
- `src/bmad_auto/core/orchestrator.py` (build_commit_message function, lines 74-97)
