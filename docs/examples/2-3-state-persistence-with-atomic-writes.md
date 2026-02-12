# Story 2.3: State Persistence with Atomic Writes

Status: done

## Story

As a **user**,
I want **workflow state saved atomically after each phase**,
so that **unexpected termination never corrupts my progress**.

## Acceptance Criteria

1. **Given** a workflow is in progress, **When** a phase completes (SM done, Dev done, Review done), **Then** state is persisted to `.bmad-auto-state.yaml` (FR12)
2. **Given** state needs to be written, **When** the write operation executes, **Then** it uses atomic write (write to temp, then rename) (NFR1) and partial writes never leave corrupted state files
3. **Given** a state file exists, **When** state is loaded, **Then** the WorkflowState is reconstructed accurately and integrity is validated (NFR3)
4. **Given** a corrupted state file, **When** loading is attempted, **Then** StateCorruptionError is raised with clear message and user is informed how to recover
5. Tests verify atomic write behavior
6. Tests verify corruption detection

## Tasks / Subtasks

- [x] Task 1: Implement state persistence in state.py (AC: 1)
  - [x] Add `save(state: WorkflowState, path: Path)` function
  - [x] Add `load(path: Path) -> WorkflowState` function
  - [x] Use pyyaml for serialization
- [x] Task 2: Implement atomic writes (AC: 2)
  - [x] Write to temporary file first (`.tmp` suffix)
  - [x] Use `os.rename()` or `Path.rename()` for atomic move
  - [x] Ensure temp file cleanup on failure
- [x] Task 3: Implement state loading with validation (AC: 3)
  - [x] Load YAML file
  - [x] Validate required fields exist
  - [x] Convert to WorkflowState dataclass
  - [x] Validate status values are legal
- [x] Task 4: Implement corruption detection (AC: 4)
  - [x] Detect malformed YAML
  - [x] Detect missing required fields
  - [x] Detect invalid status values
  - [x] Raise StateCorruptionError with recovery hints
- [x] Task 5: Write tests (AC: 5-6)
  - [x] Test atomic write succeeds
  - [x] Test atomic write cleans up temp file
  - [x] Test load reconstructs state correctly
  - [x] Test corruption detection for various cases

## Dev Notes

### Architecture Patterns & Constraints

- **CRITICAL:** Always use atomic writes (temp file + rename)
- State file path from user config: `.bmad-auto-state.yaml`
- Use pyyaml for YAML operations
- Raise StateCorruptionError from shared/exceptions.py

### Atomic Write Pattern

```python
def save(state: WorkflowState, path: Path) -> None:
    """Save state atomically."""
    temp_path = path.with_suffix('.tmp')
    try:
        temp_path.write_text(yaml.dump(state.to_dict()))
        temp_path.rename(path)  # Atomic on POSIX
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
```

### Corruption Recovery Message

```
StateCorruptionError: State file corrupted or invalid.

The file '.bmad-auto-state.yaml' appears to be corrupted.

To recover:
1. Check if backup exists: .bmad-auto-state.yaml.bak
2. Delete the corrupted file and restart with: bmad-auto run --epic <path>
3. Your completed stories (if any) remain committed in git
```

### Source Tree Components

```
src/bmad_auto/core/
├── state.py        # Add save/load functions
└── tests/
    └── test_state.py
```

### Testing Standards

- Use tmp_path fixture for test files
- Simulate corruption by writing invalid YAML
- Verify atomic behavior with process interruption

### References

- [Source: _bmad-output/project-context.md#state-persistence]
- [Source: _bmad-output/architecture/project-structure-boundaries.md#state-boundary-corestatespy]

## Dev Agent Record

### Agent Model Used

claude-opus-4-5-20251101 (glm-4.7)

### Debug Log References

N/A - Implementation completed without issues requiring debug logging.

### Completion Notes List

**Implementation Summary:**
- Added `save(state: WorkflowState, path: Path)` function to `src/bmad_auto/core/state.py` for atomic state persistence
- Added `load(path: Path) -> WorkflowState` function with comprehensive validation
- Implemented atomic write pattern using temp file (`*.tmp`) + `Path.rename()` for POSIX atomicity
- Added exception handling to clean up temp files on write failure
- Implemented field validation for all required sections (workflow, stories, current_story, error)
- Corruption detection covers: malformed YAML, missing sections/fields, invalid data types, invalid datetime format

**Tests Added (17 new tests):**
- `test_save_state_creates_yaml_file` - Verifies file creation
- `test_save_state_creates_valid_yaml` - Validates YAML format
- `test_load_state_reconstructs_workflow_state` - Tests state reconstruction
- `test_save_load_round_trip_preserves_all_data` - Tests full round-trip
- `test_atomic_write_cleans_up_temp_file` - Verifies temp cleanup on success
- `test_atomic_write_cleans_up_temp_file_on_failure` - Verifies temp cleanup on failure
- `test_atomic_write_replaces_existing_file` - Tests file replacement
- `test_load_detects_malformed_yaml` - Tests YAML corruption detection
- `test_load_detects_missing_required_sections` - Tests section validation
- `test_load_detects_missing_workflow_fields` - Tests workflow field validation
- `test_load_detects_missing_stories_fields` - Tests stories field validation
- `test_load_detects_missing_current_story_fields` - Tests current_story field validation
- `test_load_detects_invalid_datetime_format` - Tests datetime validation
- `test_load_detects_file_not_found` - Tests missing file handling
- `test_load_state_corruption_error_has_recovery_message` - Tests error messages

**Test Results:**
- All 120 tests pass (26 state tests, 94 other tests)
- No regressions introduced
- Coverage includes all acceptance criteria

### File List

**Modified:**
- `src/bmad_auto/core/state.py` - Added save() and load() functions, imports for yaml and os

**Modified:**
- `src/bmad_auto/core/tests/test_state.py` - Added 17 new tests for persistence, atomic writes, and corruption detection

## Change Log

- 2025-12-26: Implemented state persistence with atomic writes (Story 2.3)
  - Added save() and load() functions to src/bmad_auto/core/state.py
  - Added comprehensive tests for atomic writes and corruption detection
  - All acceptance criteria satisfied
