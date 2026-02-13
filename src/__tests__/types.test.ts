import { describe, it, expect } from "bun:test";
import {
  ForemanState,
  ArbiterVerdict,
  Role,
  isArbiterVerdict,
  type RoleConfig,
  type ForemanConfig,
  type StoryState,
  type SessionInfo,
} from "../types";

describe("ForemanState enum", () => {
  it("has exactly 6 values", () => {
    const states = Object.values(ForemanState);
    expect(states.length).toBe(6);
  });

  it("contains Idle", () => {
    expect(ForemanState.Idle).toBe(ForemanState.Idle);
    expect(ForemanState.Idle).toBeTypeOf("string");
  });

  it("contains Developing", () => {
    expect(ForemanState.Developing).toBe(ForemanState.Developing);
    expect(ForemanState.Developing).toBeTypeOf("string");
  });

  it("contains Reviewing", () => {
    expect(ForemanState.Reviewing).toBe(ForemanState.Reviewing);
    expect(ForemanState.Reviewing).toBeTypeOf("string");
  });

  it("contains Arbitrating", () => {
    expect(ForemanState.Arbitrating).toBe(ForemanState.Arbitrating);
    expect(ForemanState.Arbitrating).toBeTypeOf("string");
  });

  it("contains Complete", () => {
    expect(ForemanState.Complete).toBe(ForemanState.Complete);
    expect(ForemanState.Complete).toBeTypeOf("string");
  });

  it("contains Failed", () => {
    expect(ForemanState.Failed).toBe(ForemanState.Failed);
    expect(ForemanState.Failed).toBeTypeOf("string");
  });
});

describe("ArbiterVerdict enum", () => {
  it("has exactly 2 values", () => {
    const verdicts = Object.values(ArbiterVerdict);
    expect(verdicts.length).toBe(2);
  });

  it("contains Pass", () => {
    expect(ArbiterVerdict.Pass).toBe(ArbiterVerdict.Pass);
    expect(ArbiterVerdict.Pass).toBeTypeOf("string");
  });

  it("contains NeedsWork", () => {
    expect(ArbiterVerdict.NeedsWork).toBe(ArbiterVerdict.NeedsWork);
    expect(ArbiterVerdict.NeedsWork).toBeTypeOf("string");
  });
});

describe("Role enum", () => {
  it("has exactly 3 values", () => {
    const roles = Object.values(Role);
    expect(roles.length).toBe(3);
  });

  it("contains Developer", () => {
    expect(Role.Developer).toBe(Role.Developer);
    expect(Role.Developer).toBeTypeOf("string");
  });

  it("contains Reviewer", () => {
    expect(Role.Reviewer).toBe(Role.Reviewer);
    expect(Role.Reviewer).toBeTypeOf("string");
  });

  it("contains Arbiter", () => {
    expect(Role.Arbiter).toBe(Role.Arbiter);
    expect(Role.Arbiter).toBeTypeOf("string");
  });
});

describe("isArbiterVerdict type guard", () => {
  it('returns true for "Pass"', () => {
    expect(isArbiterVerdict("Pass")).toBe(true);
  });

  it('returns true for "NeedsWork"', () => {
    expect(isArbiterVerdict("NeedsWork")).toBe(true);
  });

  it('returns false for "maybe"', () => {
    expect(isArbiterVerdict("maybe")).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isArbiterVerdict("")).toBe(false);
  });

  it('returns false for "pass" (lowercase)', () => {
    expect(isArbiterVerdict("pass")).toBe(false);
  });
});

describe("RoleConfig type", () => {
  it("accepts object with model and agent fields", () => {
    const config: RoleConfig = {
      model: "anthropic/claude-sonnet-4-20250514",
      agent: "sisyphus",
    };
    expect(config.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(config.agent).toBe("sisyphus");
  });
});

describe("ForemanConfig type", () => {
  it("accepts object with all required fields", () => {
    const config: ForemanConfig = {
      stories_dir: "docs/stories",
      sprint_status: "docs/sprint-status.yaml",
      max_iterations: 3,
      contexts: ["docs/epics.md", "docs/architecture.md"],
      roles: {
        developer: { model: "anthropic/claude-sonnet-4", agent: "sisyphus" },
        reviewer: { model: "anthropic/claude-sonnet-4", agent: "sisyphus" },
        arbiter: { model: "anthropic/claude-opus-4", agent: "sisyphus" },
      },
      role_timeout_ms: 300000,
    };
    expect(config.stories_dir).toBe("docs/stories");
    expect(config.sprint_status).toBe("docs/sprint-status.yaml");
    expect(config.max_iterations).toBe(3);
    expect(config.contexts).toHaveLength(2);
    expect(config.roles.developer.model).toBe("anthropic/claude-sonnet-4");
    expect(config.role_timeout_ms).toBe(300000);
  });
});

describe("StoryState type", () => {
  it("accepts object with status, hasReviewSection, hasUnresolvedItems, taskStats", () => {
    const state: StoryState = {
      status: "in-progress",
      hasReviewSection: true,
      hasUnresolvedItems: false,
      taskStats: { total: 5, completed: 3 },
    };
    expect(state.status).toBe("in-progress");
    expect(state.hasReviewSection).toBe(true);
    expect(state.hasUnresolvedItems).toBe(false);
    expect(state.taskStats.total).toBe(5);
    expect(state.taskStats.completed).toBe(3);
  });
});

describe("SessionInfo type", () => {
  it("accepts object with sessionId, role, storyId, startedAt", () => {
    const startedAt = new Date("2026-02-12T10:00:00Z");
    const info: SessionInfo = {
      sessionId: "session-123",
      role: Role.Developer,
      storyId: "1-3",
      startedAt,
    };
    expect(info.sessionId).toBe("session-123");
    expect(info.role).toBe(Role.Developer);
    expect(info.storyId).toBe("1-3");
    expect(info.startedAt).toBe(startedAt);
  });
});
