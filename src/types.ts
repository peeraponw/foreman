/**
 * Shared type definitions for the Foreman plugin.
 *
 * This module defines:
 * - State machine states (ForemanState)
 * - Arbiter verdicts (ArbiterVerdict)
 * - Role identifiers (Role)
 * - Configuration types (RoleConfig, ForemanConfig)
 * - Story state derivation types (StoryState)
 * - Session tracking types (SessionInfo)
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Foreman state machine states.
 *
 * State transitions:
 *   Idle -> Developing -> Reviewing -> Arbitrating -> Complete
 *                                    ^              |
 *                                    |              |
 *                                    +-- needs_work +
 */
export enum ForemanState {
  Idle = "Idle",
  Developing = "Developing",
  Reviewing = "Reviewing",
  Arbitrating = "Arbitrating",
  Complete = "Complete",
  Failed = "Failed",
}

/**
 * Arbiter verdicts returned after evaluating implementation.
 *
 * - Pass: Implementation satisfies acceptance criteria
 * - NeedsWork: Implementation requires further development
 */
export enum ArbiterVerdict {
  Pass = "Pass",
  NeedsWork = "NeedsWork",
}

/**
 * Role identifiers for Foreman sessions.
 *
 * Each role runs in a separate OpenCode session with context isolation.
 */
export enum Role {
  Developer = "Developer",
  Reviewer = "Reviewer",
  Arbiter = "Arbiter",
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for ArbiterVerdict.
 * Returns true if the string is a valid ArbiterVerdict value.
 */
export function isArbiterVerdict(s: string): s is ArbiterVerdict {
  return s === ArbiterVerdict.Pass || s === ArbiterVerdict.NeedsWork;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for a single role (developer, reviewer, or arbiter).
 */
export interface RoleConfig {
  /** LLM model in "provider/model" format (e.g., "anthropic/claude-sonnet-4-20250514") */
  model: string;
  /** OpenCode agent name (e.g., "sisyphus") */
  agent: string;
}

/**
 * Full Foreman plugin configuration.
 */
export interface ForemanConfig {
  /** Directory containing BMAD story files */
  stories_dir: string;
  /** Path to sprint-status.yaml */
  sprint_status: string;
  /** Max dev-review-arbitrate cycles before stopping */
  max_iterations: number;
  /** Files the arbiter reads for project awareness */
  contexts: string[];
  /** Per-role LLM configuration */
  roles: {
    developer: RoleConfig;
    reviewer: RoleConfig;
    arbiter: RoleConfig;
  };
  /** Timeout in milliseconds for each role session */
  role_timeout_ms: number;
}

// ============================================================================
// Story State Types
// ============================================================================

/**
 * Derived state from a BMAD story file.
 * Used to determine the current ForemanState.
 */
export interface StoryState {
  /** Value of the Status: field in the story file */
  status: string;
  /** Whether a "Senior Developer Review (AI)" section exists */
  hasReviewSection: boolean;
  /** Whether the review section has unresolved action items */
  hasUnresolvedItems: boolean;
  /** Task checkbox statistics */
  taskStats: {
    /** Total number of task checkboxes */
    total: number;
    /** Number of completed (checked) tasks */
    completed: number;
  };
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Information about an active Foreman session.
 */
export interface SessionInfo {
  /** OpenCode session ID */
  sessionId: string;
  /** Current role being executed */
  role: Role;
  /** Story identifier (e.g., "1-3") */
  storyId: string;
  /** When this session was created */
  startedAt: Date;
}
