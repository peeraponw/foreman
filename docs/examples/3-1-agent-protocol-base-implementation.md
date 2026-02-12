# Story 3.1: Agent Protocol & Base Implementation

Status: done

## Story

As a **developer**,
I want **a clear AgentProtocol interface and result types**,
so that **all agents have consistent invocation patterns**.

## Acceptance Criteria

1. **Given** the agents module is implemented, **When** I import from `bmad_auto.agents.base`, **Then** I can access:
   - `AgentProtocol` with async `run(command: str) -> AgentResult` method
   - `AgentResult` dataclass with: success (bool), output (str), error (Optional[str])
   - `AgentRole` enum: SM, DEV, REVIEWER
2. AgentProtocol is a Python Protocol (structural typing)
3. Tests verify protocol compliance
4. Type hints are complete for pyright

## Tasks / Subtasks

- [x] Task 1: Create agents module structure (AC: 1)
  - [x] Create `src/bmad_auto/agents/__init__.py`
  - [x] Create `src/bmad_auto/agents/base.py`
  - [x] Export public API from __init__.py
- [x] Task 2: Implement AgentResult dataclass (AC: 1)
  - [x] Define success: bool field
  - [x] Define output: str field
  - [x] Define error: Optional[str] field
  - [x] Add factory methods for success/failure cases
- [x] Task 3: Implement AgentRole enum (AC: 1)
  - [x] Define SM, DEV, REVIEWER variants
  - [x] Link to AGENT_* constants from shared/consts.py
- [x] Task 4: Implement AgentProtocol (AC: 1-2)
  - [x] Use typing.Protocol for structural typing
  - [x] Define async run(command: str) -> AgentResult method
  - [x] Add runtime_checkable decorator
- [x] Task 5: Write tests (AC: 3-4)
  - [x] Test AgentResult creation
  - [x] Test protocol compliance check
  - [x] Verify pyright passes

## Dev Notes

### Architecture Patterns & Constraints

- Use Protocol for structural typing (duck typing with type hints)
- AgentResult is immutable (frozen dataclass)
- All agents receive prompts, return AgentResult
- Agents have no knowledge of workflow state or git

### Implementation

```python
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable
from enum import Enum

class AgentRole(Enum):
    SM = "sm"
    DEV = "dev"
    REVIEWER = "reviewer"

@dataclass(frozen=True)
class AgentResult:
    success: bool
    output: str
    error: Optional[str] = None

    @classmethod
    def ok(cls, output: str) -> "AgentResult":
        return cls(success=True, output=output)

    @classmethod
    def fail(cls, error: str) -> "AgentResult":
        return cls(success=False, output="", error=error)

@runtime_checkable
class AgentProtocol(Protocol):
    async def run(self, command: str) -> AgentResult:
        """Execute agent command and return result."""
        ...
```

### Source Tree Components

```
src/bmad_auto/agents/
├── __init__.py      # Export AgentProtocol, AgentResult, AgentRole
├── base.py          # Protocol and dataclass definitions
└── tests/
    ├── conftest.py
    └── test_base.py
```

### Testing Standards

- Test dataclass creation and factory methods
- Test Protocol compliance with isinstance check
- Verify frozen dataclass immutability

### References

- [Source: _bmad-output/architecture/project-structure-boundaries.md#agent-boundary-agents]
- [Source: _bmad-output/architecture/core-architectural-decisions.md#agent-orchestration]

## Dev Agent Record

### Agent Model Used
glm-4.7 (via Claude Code)

### Debug Log References
None - implementation was straightforward

### Completion Notes List
- All 4 AC verified
- 11 tests written and passing
- pyright 0 errors
- Implementation followed story Dev Notes exactly
- Added @runtime_checkable to AgentProtocol for isinstance() checks
- AgentResult validation in __post_init__ prevents invalid states

### File List
- src/bmad_auto/agents/__init__.py
- src/bmad_auto/agents/base.py
- src/bmad_auto/agents/tests/__init__.py
- src/bmad_auto/agents/tests/test_base.py
